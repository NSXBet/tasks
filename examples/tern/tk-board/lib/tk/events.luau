--!strict
-- Event subscription for the tk Luau client: a timer-driven poll loop over
-- GET /api/events with a client-side seq watermark.
--
-- API:
--   subscribe(client, opts) -> { stop: () -> () }
--
-- opts:
--   kinds: { string }?      -- forwarded as `kinds=a,b` (server filters; the
--                           -- client ALSO filters defensively, so a host that
--                           -- ignores the param still cannot deliver extras)
--   interval_ms: number?    -- poll cadence (default: client.interval_ms, else 2000)
--   on_event: ((event) -> ())?       -- event is the raw ring row {seq, kind, at, ...}
--   on_resync: (() -> ())?           -- the host-level `dropped` total advanced:
--                                    -- a gap was dropped server-side; the caller
--                                    -- must refetch board state. Fired once per gap.
--   on_error: ((message: string) -> ())?  -- one poll failed; the loop keeps running
--
-- Semantics:
--   - The first poll primes silently: it sets the watermark to the newest seq
--     already in the ring and baselines `dropped` without firing callbacks —
--     a fresh subscriber wants changes from now on, not history.
--   - Later polls fetch `after=<watermark>`, advance the watermark to the
--     newest seq they see, and fire on_event for each event (in seq order).
--   - A poll failure (non-200, network, malformed body) calls on_error and
--     never kills the loop.
--
-- Hosts:
--   - lune: the loop runs in a spawned task; subscribe returns immediately;
--     stop() takes effect at the next 50 ms wait tick (worst case one poll).
--   - Tern: the loop chains `client:get(...)`'s Awaitable via :next and
--     schedules the next poll with tern.timer; stop() sets the flag and
--     cancels the pending timer.

local transport = require("./transport")

local DEFAULT_INTERVAL_MS = 2000
local TICK_SECONDS = 0.05

local function detectTern(): any
	local ok, v = pcall(function()
		return (tern :: any)
	end)
	if ok and v ~= nil then
		return v
	end
	return nil
end

local ternHost = detectTern()

export type EventRow = {
	seq: number,
	kind: string,
	at: string,
}

export type SubscribeOptions = {
	kinds: { string }?,
	interval_ms: number?,
	on_event: ((event: EventRow) -> ())?,
	on_resync: (() -> ())?,
	on_error: ((message: string) -> ())?,
}

export type Subscription = {
	stop: () -> (),
}

local function buildQuery(after: number, kinds: { string }?): string
	local query = "after=" .. tostring(after)
	if kinds ~= nil and #kinds > 0 then
		query = query .. "&kinds=" .. table.concat(kinds, ",")
	end
	return query
end

-- One poll against the mock-able seam. `get` must return the shared transport
-- result shape { status, body } synchronously (the lune path; the Tern path
-- never reaches this).
local function pollSync(get: (string) -> any, path: string, handle: (any) -> (), onError: ((string) -> ())?)
	local ok, result = pcall(function()
		return get(path)
	end)
	if not ok then
		if onError ~= nil then
			onError(tostring(result))
		end
		return
	end
	if (result :: any).status ~= 200 then
		if onError ~= nil then
			onError("HTTP " .. tostring((result :: any).status) .. " from /api/events")
		end
		return
	end
	local okDecode, payload = pcall(function()
		return require("./json").decode((result :: any).body)
	end)
	if not okDecode or typeof(payload) ~= "table" or typeof((payload :: any).events) ~= "table" then
		if onError ~= nil then
			onError("malformed /api/events response")
		end
		return
	end
	handle(payload)
end

local function subscribe(client: any, opts: SubscribeOptions?): Subscription
	local options = opts or {}
	local intervalMs: number = options.interval_ms
		or client.interval_ms
		or DEFAULT_INTERVAL_MS
	local kinds = options.kinds
	local onEvent = options.on_event
	local onResync = options.on_resync
	local onError = options.on_error
	local kindSet: { [string]: boolean } = {}
	if kinds ~= nil then
		for _, kind in kinds do
			kindSet[kind] = true
		end
	end

	local stopped = false
	local primed = false
	local watermark = 0
	local lastDropped = 0

	-- Shared state machine: consumes one decoded {events, dropped} payload.
	local function handlePayload(payload: any)
		local dropped = tonumber(payload.dropped) or 0
		local newest: number? = nil
		for _, event in payload.events do
			local seq = tonumber(event.seq)
			if seq ~= nil and (newest == nil or seq > newest) then
				newest = seq
			end
		end
		if not primed then
			primed = true
			lastDropped = dropped
			watermark = newest or 0
			return
		end
		local previous = watermark
		if newest ~= nil and newest > watermark then
			watermark = newest
		end
		local gap = dropped > lastDropped
		lastDropped = dropped
		if gap and onResync ~= nil then
			onResync()
		end
		-- Deliver only rows past the pre-poll watermark (server guarantees
		-- seq > after, the filter is defense in depth).
		for _, event in payload.events do
			local seq = tonumber(event.seq)
			if seq ~= nil and seq > previous and (kinds == nil or #kinds == 0 or kindSet[event.kind] == true) then
				if onEvent ~= nil then
					onEvent(event)
				end
			end
		end
	end

	if ternHost ~= nil then
		-- Tern: chain each fetch's Awaitable; the next poll is a tern.timer.
		local pendingTimer: any = nil
		local function schedulePoll()
			if stopped then
				return
			end
			pendingTimer = ternHost.timer(intervalMs, function()
				pendingTimer = nil
				if stopped then
					return
				end
				local ok, awaited = pcall(function()
					return client:get("/api/events?" .. buildQuery(watermark, kinds))
				end)
				-- Tern's Awaitable is a host userdata, not a table; only the
				-- presence of a callable `next` identifies it.
				local nextFn: any = nil
				if ok and awaited ~= nil then
					pcall(function()
						nextFn = awaited.next
					end)
				end
				if not ok or typeof(nextFn) ~= "function" then
					if onError ~= nil then
						onError("event poll failed to start: " .. tostring(awaited))
					end
					schedulePoll()
					return
				end
				nextFn(awaited, function(result: any?, err: string?, _cx: any)
					if stopped then
						return
					end
					local normalized: any
					if result ~= nil then
						normalized = transport.tern.normalize(result)
					else
						normalized = transport.tern.normalize({ status = 0, headers = {}, body = "", error = err or "poll failed" })
					end
					if normalized.status ~= 200 then
						if onError ~= nil then
							onError("HTTP " .. tostring(normalized.status) .. " from /api/events" .. (normalized.error ~= nil and (" (" .. normalized.error .. ")") or ""))
						end
					else
						local okDecode, payload = pcall(function()
							return require("./json").decode(normalized.body)
						end)
						if okDecode and typeof(payload) == "table" and typeof(payload.events) == "table" then
							handlePayload(payload)
						elseif onError ~= nil then
							onError("malformed /api/events response")
						end
					end
					schedulePoll()
				end)
			end)
		end
		-- First poll runs immediately, not after one interval.
		schedulePoll()
		return {
			stop = function()
				stopped = true
				if pendingTimer ~= nil and pendingTimer.cancel ~= nil then
					pcall(function()
						pendingTimer.cancel()
					end)
					pendingTimer = nil
				end
			end,
		}
	end

	-- lune: synchronous transport; the loop runs in a spawned task.
	local taskLib: any = require("@lune/task")
	taskLib.spawn(function()
		while not stopped do
			pollSync(function(path: string)
				return client:get(path)
			end, "/api/events?" .. buildQuery(watermark, kinds), handlePayload, onError)
			local deadline = os.clock() + intervalMs / 1000
			while not stopped and os.clock() < deadline do
				taskLib.wait(TICK_SECONDS)
			end
		end
	end)
	return {
		stop = function()
			stopped = true
		end,
	}
end

return {
	subscribe = subscribe,
}
