--!strict
-- Lune tests for the tk transport seam. Run: lune run packages/lua/luau/tk/tests/transport_tests.luau
-- Exercises the lune impl end-to-end over loopback HTTP (happy path, network
-- failure, timeout, method/body passthrough) and the tern impl structurally
-- (no tern host under lune — normalize is pure and fully testable; request
-- exists with the right arity but needs an Awaitable host to run).
local net = require("@lune/net")
local task = require("@lune/task")
local transport = require("../transport")
local json = require("../json")

local function check(name: string, fn: () -> ())
	local ok, err = pcall(fn)
	if ok then
		print("  ok  " .. name)
	else
		print("FAIL  " .. name)
		error(err, 0)
	end
end

-- Random high port, retried on bind collision (lune reports port 0 as 0).
local function startServer(handler: any): (number, any)
	math.randomseed(os.clock() * 1e9)
	for _ = 1, 20 do
		local port = math.random(20000, 45000)
		local ok, server = pcall(function()
			return net.serve(port, handler)
		end)
		if ok then
			return port, server
		end
	end
	error("could not bind a test port", 0)
end

check("module shape: tern and lune impls present", function()
	assert(typeof(transport.tern) == "table")
	assert(typeof(transport.lune) == "table")
	assert(typeof(transport.tern.request) == "function")
	assert(typeof(transport.tern.normalize) == "function")
	assert(typeof(transport.lune.request) == "function")
end)

-- Structural check only: no tern host under lune, so tern.request cannot be
-- executed here (it dereferences the tern global). Arity is (method, url,
-- body?, timeout_ms?) per its typed signature.
check("tern.request is callable-shaped (structural — no tern host under lune)", function()
	assert(typeof(transport.tern.request) == "function")
	assert(typeof(transport.tern.normalize) == "function")
end)

check("tern.normalize: success passthrough", function()
	local r = transport.tern.normalize({ status = 200, headers = {}, body = '{"ok":true}', error = nil, timed_out = false })
	assert(r.status == 200 and r.body == '{"ok":true}')
end)

check("tern.normalize: network error", function()
	local r = transport.tern.normalize({ status = 0, headers = {}, body = "", error = "Connection refused (os error 61)", timed_out = false })
	assert(r.status == -1 and r.error == "Connection refused (os error 61)" and r.body == "")
end)

check("tern.normalize: timeout via timed_out flag", function()
	local r = transport.tern.normalize({ status = 0, headers = {}, body = "", error = nil, timed_out = true })
	assert(r.status == -1 and r.error == "timed out" and r.body == "")
end)

check("lune.request: happy path with method + body passthrough", function()
	local port, server = startServer(function(req: any)
		local body = req.body :: string
		return {
			status = 200,
			headers = { ["content-type"] = "application/json" },
			body = json.encode({ method = req.method, path = req.path, parsed = json.decode(body) }),
		}
	end)
	local ok, res = pcall(function()
		return transport.lune.request("POST", "http://127.0.0.1:" .. port .. "/api/rpc", '{"verb":"issue.create"}', 5000)
	end)
	server:stop()
	assert(ok)
	assert(res.status == 200, "status " .. tostring(res.status))
	local echoed = json.decode(res.body)
	assert(echoed.method == "POST" and echoed.path == "/api/rpc")
	assert(echoed.parsed.verb == "issue.create")
end)

check("lune.request: GET without body", function()
	local port, server = startServer(function(req: any)
		local q: any = req.query
		return {
			status = 200,
			body = req.method .. " " .. req.path .. " after=" .. tostring(q.after) .. " kinds=" .. tostring(q.kinds),
		}
	end)
	local ok, res = pcall(function()
		return transport.lune.request("GET", "http://127.0.0.1:" .. port .. "/api/events?after=5&kinds=a,b", nil, 5000)
	end)
	server:stop()
	assert(ok)
	assert(res.status == 200)
	assert(res.body == "GET /api/events after=5 kinds=a,b", "got " .. res.body)
end)

check("lune.request: connection refused -> {status=-1, error set}", function()
	-- Nothing is listening on 1 (root port); expect the normalized failure shape.
	local res = transport.lune.request("POST", "http://127.0.0.1:1/api/rpc", "{}", 5000)
	assert(res.status == -1, "status " .. tostring(res.status))
	assert(typeof(res.error) == "string" and #res.error > 0, "expected an error message")
	assert(res.body == "")
end)

check("lune.request: timeout cancels the request -> {status=-1, error='timed out'}", function()
	local port, server = startServer(function()
		task.wait(2)
		return { status = 200, body = "too late" }
	end)
	local t0 = os.clock()
	local res = transport.lune.request("GET", "http://127.0.0.1:" .. port .. "/api/events?after=0", nil, 100)
	local elapsed = os.clock() - t0
	server:stop()
	assert(res.status == -1, "status " .. tostring(res.status))
	assert(res.error == "timed out", "error " .. tostring(res.error))
	assert(elapsed < 1, "timeout did not fire early: " .. tostring(elapsed) .. "s")
end)

check("lune.request: any HTTP status is returned (non-2xx is an answer, not an error)", function()
	local port, server = startServer(function()
		return { status = 500, body = '{"kind":"internal"}' }
	end)
	local ok, res = pcall(function()
		return transport.lune.request("POST", "http://127.0.0.1:" .. port .. "/api/rpc", "{}", 5000)
	end)
	server:stop()
	assert(ok)
	assert(res.status == 500 and res.body == '{"kind":"internal"}')
end)

print("transport_tests: all passed")
