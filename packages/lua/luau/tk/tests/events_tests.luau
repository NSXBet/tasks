--!strict
-- Lune tests for the tk events poll loop. Run: lune run packages/lua/luau/tk/tests/events_tests.luau
-- Mock server serves /api/rpc (hello for connect) and /api/events with a
-- scriptable event list, dropped counter, and a one-shot 500 failure.
local net = require("@lune/net")
local taskLib = require("@lune/task")
local serde = require("@lune/serde")
local clientLib = require("../client")
local events = require("../events")

local function check(name: string, fn: () -> ())
	local ok, err = pcall(fn)
	if ok then
		print("  ok  " .. name)
	else
		print("FAIL  " .. name)
		error(err, 0)
	end
end

local HELLO_VALUE = { tk = "tk", protocol = 2, verbs = 2, methods = { "hello" } }

local function connectMock(): (any, any, any)
	local state = {
		events = {}, -- { {seq, kind, at} }
		dropped = 0,
		failOnce = false,
		filterKinds = false, -- true: mock applies the kinds filter like the real server
		afters = {}, -- every after value received, in order
		kindsSeen = nil :: string?,
		hits = 0,
	}
	local boundPort = math.random(20000, 45000)
	local bound = net.serve(boundPort, function(req: any)
		local q = req.query or {}
		if req.path == "/api/rpc" then
			local envelope = serde.decode("json", req.body :: string)
			return {
				status = 200,
				headers = { ["content-type"] = "application/json" },
				body = serde.encode("json", { v = 2, id = envelope.id, ok = true, value = HELLO_VALUE }),
			}
		end
		if req.path == "/api/events" then
			state.hits += 1
			local after = tonumber(q["after"] or "0") or 0
			table.insert(state.afters, tostring(after))
			state.kindsSeen = q["kinds"]
			if state.failOnce then
				state.failOnce = false
				return { status = 500, body = "boom" }
			end
			local visible = {}
			for _, event in state.events do
				local passes = (event.seq :: number) > after
				if passes and state.filterKinds and state.kindsSeen ~= nil then
					passes = false
					for kind in string.gmatch(state.kindsSeen :: string, "[^,]+") do
						if kind == event.kind then
							passes = true
							break
						end
					end
				end
				if passes then
					table.insert(visible, event)
				end
			end
			return {
				status = 200,
				headers = { ["content-type"] = "application/json" },
				body = serde.encode("json", { events = visible, dropped = state.dropped }),
			}
		end
		return { status = 404, body = "not found" }
	end)
	local client = clientLib.connect("/tmp/tk-events-tests-does-not-exist", { port = boundPort })
	return client, state, bound
end

local function addEvent(state: any, seq: number, kind: string)
	table.insert(state.events, { seq = seq, kind = kind, at = "2026-10-19T00:00:00Z" })
end

check("poll loop receives events created after subscribe; watermark advances", function()
	local client, state, server = connectMock()
	local delivered = {}
	local sub = events.subscribe(client, {
		interval_ms = 100,
		on_event = function(event)
			table.insert(delivered, event.seq)
		end,
	})
	taskLib.wait(0.3) -- prime poll (after=0, empty)
	addEvent(state, 1, "issue.created")
	addEvent(state, 2, "issue.created")
	taskLib.wait(0.5)
	sub.stop()
	server:stop()
	assert(#delivered == 2 and delivered[1] == 1 and delivered[2] == 2, "delivered: " .. serde.encode("json", delivered))
	assert(state.afters[#state.afters :: number] == "2", "last after should be watermark 2, got " .. tostring(state.afters[#state.afters]))
end)

check("kinds filter is forwarded and enforced client-side", function()
	local client, state, server = connectMock()
	local delivered = {}
	local sub = events.subscribe(client, {
		interval_ms = 100,
		kinds = { "issue.created", "issue.updated" },
		on_event = function(event)
			table.insert(delivered, event.kind)
		end,
	})
	taskLib.wait(0.3)
	addEvent(state, 1, "issue.created")
	addEvent(state, 2, "board.changed") -- mock ignores kinds; client must filter
	addEvent(state, 3, "issue.updated")
	taskLib.wait(0.5)
	sub.stop()
	server:stop()
	assert(state.kindsSeen == "issue.created,issue.updated", "kinds param: " .. tostring(state.kindsSeen))
	assert(#delivered == 2 and delivered[1] == "issue.created" and delivered[2] == "issue.updated", "delivered: " .. serde.encode("json", delivered))
end)

check("dropped>0 fires on_resync exactly once", function()
	local client, state, server = connectMock()
	local resyncs = 0
	local sub = events.subscribe(client, {
		interval_ms = 100,
		on_resync = function()
			resyncs += 1
		end,
	})
	taskLib.wait(0.3) -- prime baselines dropped=0
	state.dropped = 5
	taskLib.wait(0.5) -- several polls, all seeing dropped=5
	sub.stop()
	server:stop()
	assert(resyncs == 1, "resync fired " .. tostring(resyncs) .. " times, expected 1")
end)

check("on_error fires on HTTP 500 and the loop keeps polling", function()
	local client, state, server = connectMock()
	local errors = {}
	local delivered = {}
	local sub = events.subscribe(client, {
		interval_ms = 100,
		on_error = function(message)
			table.insert(errors, message)
		end,
		on_event = function(event)
			table.insert(delivered, event.seq)
		end,
	})
	taskLib.wait(0.1)
	state.failOnce = true
	taskLib.wait(0.4)
	assert(#errors >= 1, "expected at least one on_error, got none")
	addEvent(state, 1, "issue.created")
	taskLib.wait(0.4)
	sub.stop()
	server:stop()
	assert(#delivered == 1 and delivered[1] == 1, "loop died after the 500; delivered: " .. serde.encode("json", delivered))
end)

check("stop() terminates the loop within one interval", function()
	local client, state, server = connectMock()
	local sub = events.subscribe(client, { interval_ms = 150 })
	taskLib.wait(0.5) -- a few polls
	sub.stop()
	local hitsAtStop = state.hits
	taskLib.wait(0.9) -- ~6 intervals would elapse if the loop kept running
	server:stop()
	assert(state.hits - hitsAtStop <= 1, "loop kept polling after stop(): " .. tostring(state.hits - hitsAtStop) .. " extra polls")
end)

print("events_tests: all passed")
