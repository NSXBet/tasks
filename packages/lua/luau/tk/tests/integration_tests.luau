--!strict
-- Integration e2e for the tk Luau client against the REAL tk web server.
-- Run: lune run packages/lua/luau/tk/tests/integration_tests.luau
--
-- No mocks: this script boots the actual server (`bun packages/web/src/main.ts`)
-- over a freshly initialized temp workspace, lets it register its `web` row in
-- `<root>/.tasks/runtime.json`, and drives everything through the real client
-- discovery + HTTP transport (the same path Tern plugins use).
local process = require("@lune/process")
local fs = require("@lune/fs")
local taskLib = require("@lune/task")
local net = require("@lune/net")
local serde = require("@lune/serde")

local wire = require("../wire")
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

math.randomseed(os.time() + math.floor(os.clock() * 1e9))

local function fileExists(path: string): boolean
	local ok, meta = pcall(fs.metadata, path)
	-- lune returns a table with exists=false for missing paths (pcall never fails).
	return ok and meta ~= nil and (meta :: any).exists == true
end

-- Repo root: walk up from cwd until packages/web/src/main.ts exists.
local function findRepoRoot(): string
	-- lune's process.cwd carries a trailing slash, which breaks the parent-strip
	-- match below; normalize first.
	local dir = (process.cwd :: string):gsub("/+$", "")
	for _ = 1, 8 do
		if fileExists(dir .. "/packages/web/src/main.ts") then
			return dir
		end
		local parent = dir:match("^(.*)/[^/]+$")
		if parent == nil or parent == dir then
			break
		end
		dir = parent
	end
	error("could not locate repo root (packages/web/src/main.ts) from cwd " .. process.cwd)
end

local function readWebRow(root: string): any?
	local ok, content = pcall(fs.readFile, root .. "/.tasks/runtime.json")
	if not ok or typeof(content) ~= "string" then
		return nil
	end
	local okDecode, rows = pcall(serde.decode, "json", content :: string)
	if not okDecode or typeof(rows) ~= "table" then
		return nil
	end
	for _, row in (rows :: any) :: { any } do
		if typeof(row) == "table" and row.kind == "web" then
			return row
		end
	end
	return nil
end

-- Boot the real web server over the workspace; poll real client discovery
-- (connect with no opts.port) until it finds the registered row. Retries on
-- another random port if the first candidate is taken.
local function startRealServer(repoRoot: string, root: string): (any, any)
	for _ = 1, 3 do
		local port = math.random(21000, 45000)
		local child = process.create("bun", { repoRoot .. "/packages/web/src/main.ts", root, "--port", tostring(port) }, {
			cwd = repoRoot,
			stdio = { stdin = "none", stdout = "default", stderr = "default" },
		})
		local deadline = os.clock() + 15
		while os.clock() < deadline do
			local ok, client = pcall(function()
				return clientLib.connect(root)
			end)
			if ok then
				return child, client
			end
			taskLib.wait(0.2)
		end
		pcall(function()
			child:kill()
		end)
	end
	error("could not start tk web server on 3 candidate ports")
end

local function stopServer(child: any, port: number): ()
	-- Graceful: the HTTP route tears the server down and unregisters the row.
	pcall(function()
		net.request("http://127.0.0.1:" .. tostring(port) .. "/api/stop", { method = "POST" })
	end)
	pcall(function()
		child:kill()
	end)
end

local repoRoot = findRepoRoot()
local root = "/tmp/tk-lua-int-" .. tostring(os.time()) .. "-" .. tostring(math.random(1000, 9999))
fs.writeDir(root)
print("workspace: " .. root)

local initChild = process.create("bun", { repoRoot .. "/packages/cli/src/tk.ts", "-C", root, "init", "--json" }, {
	cwd = repoRoot,
	stdio = { stdin = "none", stdout = "forward", stderr = "forward" },
})
local initStatus = initChild:status()
assert(initStatus.ok and initStatus.code == 0, "tk init failed (" .. tostring(initStatus.code) .. ")")

local serverChild, client = startRealServer(repoRoot, root)

check("discovery: real client.connect() finds the web row in .tasks/runtime.json", function()
	local row = readWebRow(root)
	assert(row ~= nil, "no kind=web row in " .. root .. "/.tasks/runtime.json")
	assert(typeof(row.url) == "string" and row.url ~= "", "web row missing url")
	assert(typeof(row.port) == "number", "web row missing port")
	-- `client` was produced by connect(root) with no opts.port, so discovery
	-- used exactly this registry row.
	assert(typeof(client) == "table")
end)

check("hello: real server matches wire constants", function()
	local hello = client:call("hello", {})
	assert(hello.tk == "tk", "hello.tk mismatch: " .. tostring(hello.tk))
	assert(hello.protocol == wire.PROTOCOL_VERSION, "protocol version mismatch: " .. tostring(hello.protocol))
	assert(hello.verbs == wire.VERBS_VERSION, "verbs version mismatch: " .. tostring(hello.verbs))
	local seen: { [string]: boolean } = {}
	for _, m in hello.methods :: { any } do
		seen[m :: string] = true
	end
	for _, m in wire.METHODS do
		assert(seen[m], "hello.methods missing " .. m)
	end
end)

local createdId: string? = nil

check("issue.create + issue.show roundtrip through real serde + envelope", function()
	local created = client.issue.create({
		title = "integration e2e — Tern bridge",
		description = "created by integration_tests.luau\nsecond line",
		priority = 2,
		labels = { "tern-lua" },
	}) :: any
	assert(typeof(created) == "table" and typeof(created.id) == "string" and (created :: any).id ~= "", "issue.create returned no id")
	createdId = created.id

	local shown = client.issue.show({ id = createdId :: string }) :: any
	assert(shown.title == "integration e2e — Tern bridge", "title roundtrip mismatch: " .. tostring(shown.title))
	assert(shown.priority == 2, "priority roundtrip mismatch: " .. tostring(shown.priority))
	assert(typeof(shown.labels) == "table" and (shown :: any).labels[1] == "tern-lua", "labels roundtrip mismatch")
end)

check("issue.list sees the created issue", function()
	local listed = client.issue.list({}) :: any
	assert(typeof(listed) == "table", "issue.list did not return a table")
	for _, issue in listed :: { any } do
		if typeof(issue) == "table" and issue.id == createdId then
			return
		end
	end
	error("created issue " .. tostring(createdId) .. " missing from issue.list")
end)

check("events: subscribe fires on_event for issue.created from a second client", function()
	-- Drain: wait until the watch loop has caught up with everything created
	-- earlier in this run, so its baseline pass cannot deliver stale events
	-- after the watermark prime below.
	local drained = false
	local deadline = os.clock() + 10
	while not drained and os.clock() < deadline do
		local raw = client:get("/api/events?after=0")
		if typeof(raw) == "table" and (raw :: any).status == 200 then
			local payload = serde.decode("json", (raw :: any).body :: string)
			if typeof(payload.events) == "table" and #payload.events > 0 then
				drained = true
			end
		end
		if not drained then
			taskLib.wait(0.25)
		end
	end
	assert(drained, "watch loop never reported an event within 10s")

	local fired: any? = nil
	local errors: { string } = {}
	local sub = events.subscribe(client, {
		kinds = { "issue.created" },
		interval_ms = 200,
		on_event = function(event: any)
			fired = event
		end,
		on_error = function(message: string)
			table.insert(errors, message)
		end,
	})
	-- Let the first (priming) poll set the watermark.
	taskLib.wait(0.6)

	-- Generate the event through a SECOND real client connection.
	local second = clientLib.connect(root)
	local other = second.issue.create({ title = "event source issue" }) :: any
	assert(typeof(other) == "table" and typeof(other.id) == "string", "second issue.create failed")

	local deadline = os.clock() + 5
	while fired == nil and os.clock() < deadline do
		taskLib.wait(0.05)
	end
	assert(fired ~= nil, "on_event did not fire within 5s; poll errors: " .. table.concat(errors, "; "))
	local event = fired :: any
	assert(event.kind == "issue.created", "wrong event kind: " .. tostring(event.kind))
	assert(event.issueId == (other :: any).id, "event payload issueId mismatch: " .. tostring(event.issueId))
	assert(typeof(event.seq) == "number" and typeof(event.at) == "string", "event row missing seq/at")

	sub.stop()
	assert(#errors == 0, "unexpected poll errors: " .. table.concat(errors, "; "))
end)

check("events: stop() stops delivery", function()
	local count = 0
	local sub = events.subscribe(client, {
		kinds = { "issue.created" },
		interval_ms = 200,
		on_event = function(_event: any)
			count += 1
		end,
	})
	taskLib.wait(0.6) -- prime
	sub.stop()
	client.issue.create({ title = "post-stop issue" })
	taskLib.wait(0.9)
	assert(count == 0, "on_event fired " .. tostring(count) .. "x after stop()")
end)

check("villain: unknown method surfaces a structured error kind", function()
	expectErrorKind("unknown method", function()
		client:call("bogus.verb", {})
	end, "method_unknown")
end)

local portRow = readWebRow(root)
stopServer(serverChild, if portRow ~= nil and typeof(portRow.port) == "number" then portRow.port else 0)
pcall(function()
	fs.removeDir(root)
end)

print("integration_tests: all passed")
