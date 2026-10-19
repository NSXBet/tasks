--!strict
-- Transport seam for the tk Luau client.
--
-- Module shape: { tern = TernImpl, lune = LuneImpl }
--
-- `lune.request(method, url, body, timeout_ms)` is synchronous and returns the
-- shared result shape:
--     { status: number, body: string }              -- HTTP answer (any status)
--     { status: -1, error: string, body: "" }       -- network failure / timeout
--
-- `tern.request(...)` cannot be synchronous: `tern.fetch` (without a callback)
-- returns an `Awaitable<FetchResult>` and `Awaitable:next` returns nothing, so
-- the awaited value cannot be mapped inline. Under Tern the caller (client.luau,
-- invoked from plugin code via `await`) must:
--     local result = transport.tern.normalize(await transport.tern.request(...))
-- `tern.normalize(FetchResult)` is pure and converts the raw awaited result to
-- the shared shape above: `status 0`, a set `error`, or `timed_out` become
-- `{ status = -1, error = <msg>, body = "" }` (timeouts report `"timed out"`).
--
-- Detection: the Tern global is probed with pcall; `@lune/net` is only required
-- (pcall-gated) when no Tern host is present, so no lune-only require is ever
-- reached on the Tern path.

local ternHost: any = nil
do
	local ok, v = pcall(function()
		return (tern :: any)
	end)
	if ok and v ~= nil then
		ternHost = v
	end
end

local net: any = nil
if ternHost == nil then
	local ok, v = pcall(function()
		return require("@lune/net")
	end)
	if ok then
		net = v
	end
end

local function normalizeFetchResult(res: any): any
	local err: string? = res.error
	if not err and res.timed_out then
		err = "timed out"
	end
	if err then
		return { status = -1, error = err, body = "" }
	end
	return { status = res.status, body = res.body or "" }
end

-- Under Tern this returns the raw Awaitable<FetchResult> from tern.fetch; see
-- the header for the await + normalize protocol. It is only ever called under
-- the Tern host (the global is nil elsewhere).
local ternImpl = {
	request = function(method: string, url: string, body: string?, timeout_ms: number?): any
		local opts: any = {
			method = method,
			timeout_ms = if timeout_ms ~= nil then timeout_ms else 30000,
		}
		if body ~= nil then
			opts.body = body
		end
		return ternHost.fetch(url, opts)
	end,
	normalize = normalizeFetchResult,
}

-- Lune: net.request raises on connection failure and has no timeout option,
-- so the request runs in a spawned task; a task.delay watchdog cancels it on
-- timeout (lune has no task.join — completion is signalled via the closure).
local luneImpl = {
	request = function(method: string, url: string, body: string?, timeout_ms: number?): any
		local taskLib: any = require("@lune/task")
		local done = false
		local result: any = nil
		local err: string? = nil

		local co = taskLib.spawn(function()
			local ok, res = pcall(function()
				local req: any = { url = url, method = method }
				if body ~= nil then
					req.body = body
				end
				return net.request(req)
			end)
			if ok then
				result = res
			else
				err = tostring(res)
			end
			done = true
		end)

		if timeout_ms ~= nil and timeout_ms > 0 then
			taskLib.delay(timeout_ms / 1000, function()
				if not done then
					done = true
					if coroutine.status(co) ~= "dead" then
						taskLib.cancel(co)
					end
					err = "timed out"
				end
			end)
		end

		while not done do
			taskLib.wait(0.01)
		end

		if err ~= nil then
			return { status = -1, error = err :: string, body = "" }
		end
		-- lune's result is { statusCode, body }; normalize to the shared
		-- { status, body, error? } consumer shape.
		local status = tonumber(result.statusCode) or -1
		local out = { status = status, body = typeof(result.body) == "string" and result.body or "" }
		return out
	end,
}

return {
	tern = ternImpl,
	lune = luneImpl,
}
