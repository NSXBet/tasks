--!strict
-- Lune tests for the tk RPC client. Run: lune run packages/lua/luau/tk/tests/client_tests.luau
-- Convention: plain script, asserts abort with a Lua error (lune exits nonzero).
local net = require("@lune/net")
local serde = require("@lune/serde")
local fs = require("@lune/fs")

local wire = require("../wire")
local clientLib = require("../client")

local function check(name: string, fn: () -> ())
	local ok, err = pcall(fn)
	if ok then
		print("  ok  " .. name)
	else
		print("FAIL  " .. name)
		error(err, 0)
	end
end

local function deepEqual(a: any, b: any): boolean
	if typeof(a) ~= typeof(b) then
		return false
	end
	if typeof(a) == "table" then
		local seen: { [any]: boolean } = {}
		for k, v in a do
			if not deepEqual(v, (b :: any)[k]) then
				return false
			end
			seen[k] = true
		end
		for k in b :: any do
			if not seen[k] then
				return false
			end
		end
		return true
	end
	return a == b
end

local function expectErrorKind(name: string, fn: () -> (), kind: string)
	local ok, err = pcall(fn)
	assert(not ok, name .. ": expected error, got success")
	assert(typeof(err) == "table" and (err :: any).kind == kind, name .. ": expected kind " .. kind .. ", got " .. tostring(err))
end

-- Mock tk web server: routes /api/status, /api/rpc (envelope protocol),
-- /api/events. `record` accumulates observed RPC envelopes and ids.
math.randomseed(os.clock() * 1e9)
local function startServer(helloValue: any?): (number, any, { [string]: any })
	local record: { [string]: any } = { ids = {}, envelopes = {} }
	local port = math.random(20000, 45000)
	local server = net.serve(port, function(req: any)
		local body = req.body :: string? or ""
		if req.path == "/api/status" then
			return { status = 200, body = "ok" }
		end
		if req.path == "/api/events" then
			return { status = 200, body = '{"events":[],"dropped":0}' }
		end
		if req.path == "/api/rpc" then
			local envelope = serde.decode("json", body)
			table.insert(record.envelopes, envelope)
			table.insert(record.ids, envelope.id)
			if envelope.method == "hello" then
				local value = helloValue or { tk = "tk", protocol = 1, verbs = 2, methods = {} }
				return {
					status = 200,
					body = serde.encode("json",{ v = 1, id = envelope.id, ok = true, value = value }),
				}
			end
			if envelope.method == "fail" then
				return {
					status = 200,
					body = serde.encode("json",{ v = 1, id = envelope.id, ok = false, error = { kind = "param_invalid", message = "bad params" } }),
				}
			end
			return {
				status = 200,
				body = serde.encode("json",{ v = 1, id = envelope.id, ok = true, value = { echoed = envelope.params, method = envelope.method } }),
			}
		end
		return { status = 500, body = serde.encode("json",{ raw = "text, not json" }) }
	end)
	return port, server, record
end

local function tempRoot(): string
	local dir = "/tmp/tk-client-tests-" .. tostring(os.clock()):gsub("%.", "-") .. "-" .. tostring(math.random(1, 1e9))
	fs.writeDir(dir .. "/.tasks")
	return dir
end

local function writeRegistryRow(dir: string, url: string, port: number)
	fs.writeFile(dir .. "/.tasks/runtime.json", serde.encode("json",{ { id = "web", kind = "web", url = url, port = port, pid = os.clock() } }))
end

check("connect with explicit port runs hello + version check", function()
	local port, server, _ = startServer()
	local c = clientLib.connect("/tmp/does-not-exist", { port = port })
	server:stop()
	assert(c.url == "http://localhost:" .. port, c.url)
	assert(c.port == port)
end)

check("connect discovers from runtime.json registry row (status probe)", function()
	local port, server, _ = startServer()
	local dir = tempRoot()
	writeRegistryRow(dir, "http://localhost:" .. port, port)
	local c = clientLib.connect(dir)
	server:stop()
	assert(c.port == port)
	assert(c.url == "http://localhost:" .. port)
end)

check("connect on stale registry row raises discovery (no bootstrap under lune)", function()
	local port, server, _ = startServer()
	server:stop() -- dead port
	local dir = tempRoot()
	writeRegistryRow(dir, "http://localhost:" .. port, port)
	expectErrorKind("stale row", function()
		clientLib.connect(dir)
	end, "discovery")
end)

check("connect on absent registry row raises discovery", function()
	expectErrorKind("absent row", function()
		clientLib.connect("/tmp/tk-client-tests-nonexistent-root")
	end, "discovery")
end)

check("connect raises contract_mismatch on version drift", function()
	local port, server, _ = startServer({ tk = "tk", protocol = 99, verbs = 2, methods = {} })
	expectErrorKind("version drift", function()
		clientLib.connect("/tmp/does-not-exist", { port = port })
	end, "contract_mismatch")
	server:stop()
end)

check("call posts envelope {v:1, id, method, params} with monotonic ids and no root", function()
	local port, server, record = startServer()
	local c = clientLib.connect("/tmp/does-not-exist", { port = port })
	local v1 = c:call("issue.list", { limit = 5 })
	local v2 = c:call("board.get")
	server:stop()
	assert(deepEqual(v1, { echoed = { limit = 5 }, method = "issue.list" }), serde.encode("json",v1))
	assert(v2.method == "board.get")
	-- connect() fires hello first (id "1"); the two user calls follow.
	assert(deepEqual(record.ids, { "1", "2", "3" }), serde.encode("json",record.ids))
	assert(record.envelopes[1].method == "hello")
	local envelope = record.envelopes[2] :: any
	assert(envelope.v == 1)
	assert(envelope.method == "issue.list")
	assert(envelope.root == nil, "client must not send root (injected server-side)")
end)

check("ok:false surfaces {kind, message} as RpcCallError", function()
	local port, server, _ = startServer()
	local c = clientLib.connect("/tmp/does-not-exist", { port = port })
	local ok, err = pcall(function()
		return c:call("fail", {})
	end)
	server:stop()
	assert(not ok)
	assert(typeof(err) == "table" and (err :: any).kind == "param_invalid" and (err :: any).message == "bad params", tostring(err))
	assert(tostring(err):find("param_invalid") ~= nil, "error renders kind")
end)

check("verb helpers exist for every wire.METHODS verb and route correctly", function()
	local port, server, record = startServer()
	local c = clientLib.connect("/tmp/does-not-exist", { port = port })
	local domainCount = 0
	local helperCount = 0
	for domain, verbs in c :: any do
		if typeof(verbs) == "table" then
			domainCount += 1
			for _ in verbs :: any do
				helperCount += 1
			end
			-- every domain entry is a verb table, not a scalar field
			for name in verbs :: any do
				assert(typeof((verbs :: any)[name]) == "function", domain .. "." .. name .. " is not a function")
			end
		end
	end
	-- every METHOD except the dotless bootstrap verb `hello` gets a helper
	local dotted = 0
	for _, verb in wire.METHODS do
		if (verb :: string):find(".", 1, true) ~= nil then
			dotted += 1
		end
	end
	assert(helperCount == dotted, "helpers " .. tostring(helperCount) .. " != dotted methods " .. tostring(dotted))
	local value = c.issue.list({ type = "story" })
	server:stop()
	assert(value.method == "issue.list")
	assert(value.echoed.type == "story")
end)

check("400 with envelope error body surfaces the server error kind", function()
	local port, server, _ = startServer()
	server:stop()
	-- Reuse unwrap directly: non-2xx answers carry the same envelope.
	local errKind = select(2, pcall(function()
		return clientLib.unwrap({ status = 400, body = '{"v":1,"id":"1","ok":false,"error":{"kind":"method_unknown","message":"no such method"}}', error = nil })
	end))
	assert((errKind :: any).kind == "method_unknown", tostring(errKind))
end)

check("non-JSON body raises http error", function()
	expectErrorKind("non-json", function()
		return clientLib.unwrap({ status = 500, body = "<html>boom</html>", error = nil })
	end, "http")
end)

check("timeout result raises kind=timeout", function()
	expectErrorKind("timeout", function()
		return clientLib.unwrap({ status = -1, error = "timed out", body = "" })
	end, "timeout")
end)

check("network failure raises kind=network", function()
	-- Real dead port through a live client (server stopped, new client).
	expectErrorKind("network", function()
		local c = clientLib.connect("/tmp/does-not-exist", { port = 1 })
		return c:call("hello", {})
	end, "network")
end)

check("network failure result raises kind=network via unwrap", function()
	expectErrorKind("network raw", function()
		return clientLib.unwrap({ status = -1, error = "connection refused", body = "" })
	end, "network")
end)

check("get(path) returns the raw HTTP result for /api/events", function()
	local port, server, _ = startServer()
	local c = clientLib.connect("/tmp/does-not-exist", { port = port })
	local raw = c:get("/api/events?after=0")
	server:stop()
	assert(typeof(raw) == "table" and (raw :: any).status == 200, tostring(raw))
	local parsed = serde.decode("json", (raw :: any).body)
	assert(parsed.events ~= nil and parsed.dropped == 0)
end)

print("client_tests: all passed")
