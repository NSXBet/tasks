--!strict
-- RPC client for the tk web server (Tern plugins and lune tests).
--
-- Built on the transport seam (`transport.luau`) and the hand-written contract
-- (`wire.luau`); this file contains zero contract knowledge of its own — every
-- method name comes from `wire.METHODS`, protocol/verbs versions from `wire`.
--
-- API:
--   connect(root, opts?) -> client
--     opts: { port: number?, timeout_ms: number?, interval_ms: number? }
--     Discovery: reads `<root>/.tasks/runtime.json` (kind "web" row). Stale or
--     absent: under Tern spawns `tk web` via tern.process.run and re-reads;
--     under lune this is a discovery error (no process spawn in tests).
--     The registry URL is validated with GET /api/status (any HTTP answer
--     counts as alive; network-level failure = stale row).
--   client:call(method, params) -> value
--   client:get(path)            -> { status, body }   -- raw HTTP, for /api/events
--   client.<domain>.<verb>(params)                     -- verb helpers (one per CLI command),
--     e.g. client.issue.create({ title = "..." }); one per wire.METHODS entry.
--
-- Host asymmetry (inherited from the transport seam):
--   - Under lune `call`/`get` are synchronous: `call` returns the decoded RPC
--     value directly, `get` returns `{status, body}`.
--   - Under Tern `tern.request` returns an Awaitable the host must await, so
--     `call`/`get` return the raw Awaitable; the caller resolves with:
--         local value = client.unwrap(transport.tern.normalize(await client:call(m, p)))
--     `unwrap` is the pure result decoder (shared by both hosts) and also
--     performs the version check whenever a hello value passes through it.
--   - The connect-time GET /api/status probe and hello check only run when the
--     transport is synchronous (lune); under Tern the version check still
--     fires on the first resolved hello (see `unwrap`).
--
-- Errors: raised as RpcCallError tables `{ kind, message }` with a `__tostring`
-- (renders "tk.client: [kind] message"), so `pcall` callers can both inspect
-- `e.kind` and print the error.

local wire = require("./wire")
local json = require("./json")
local transport = require("./transport")

local DEFAULT_TIMEOUT_MS = 5000
local DEFAULT_INTERVAL_MS = 2000

-- Placeholder shape for the async (Tern) bootstrap path: a client with the
-- identity fields but no call/get yet; `connect` fills it in when the
-- `tk web` spawn resolves. Callers must gate on `on_ready` before calling.
local function clientTemplate(): any
	return {
		root = "",
		url = "",
		port = nil,
		timeout_ms = 0,
		interval_ms = 0,
		id = 0,
	}
end

-- Host detection, same convention as json.luau.
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

local fsHost: any = nil
local netSync: any = nil
if ternHost == nil then
	local okFs, fs = pcall(function()
		return require("@lune/fs")
	end)
	if okFs then
		fsHost = fs
	end
	local okNet, net = pcall(function()
		return require("@lune/net")
	end)
	if okNet then
		netSync = net
	end
end

-- transport impl: tern.fetch under Tern, lune net.request under lune.
local transportImpl: any = ternHost ~= nil and transport.tern or transport.lune

local function raiseError(kind: string, message: string): never
	local err = {
		kind = kind,
		message = message,
	}
	setmetatable(err, {
		__tostring = function(e: any): string
			return "tk.client: [" .. e.kind .. "] " .. e.message
		end,
	})
	error(err :: any, 0)
end

-- Pure result decoder — the ONLY place an HTTP answer is interpreted.
-- Input: normalized transport result { status: number, body: string }
--   (status -1 with error "timed out" is the timeout marker).
-- Output: decoded RPC value. Version check: a hello value whose protocol/verbs
-- drift from wire raises contract_mismatch on both hosts.
local function unwrap(result: { status: number, body: string, error: string? }): any
	if result.status == -1 then
		if result.error == "timed out" then
			raiseError("timeout", "request timed out")
		end
		raiseError("network", result.error or "network failure")
	end
	local okDecode, envelope = pcall(function()
		return json.decode(result.body)
	end)
	if not okDecode or typeof(envelope) ~= "table" then
		raiseError("http", "HTTP " .. result.status .. " with non-JSON body")
	end
	local function checkHello(value: any): any
		if typeof(value) == "table" and value.tk == "tk" then
			if value.protocol ~= wire.PROTOCOL_VERSION or value.verbs ~= wire.VERBS_VERSION then
				raiseError(
					"contract_mismatch",
					string.format(
						"server protocol %s/verbs %s does not match client %d/%d (update wire.luau or the tk server)",
						tostring(value.protocol),
						tostring(value.verbs),
						wire.PROTOCOL_VERSION,
						wire.VERBS_VERSION
					)
				)
			end
		end
		return value
	end
	if envelope.ok == true then
		return checkHello(envelope.value)
	end
	if envelope.ok == false and typeof(envelope.error) == "table" then
		raiseError(tostring(envelope.error.kind or "unknown"), tostring(envelope.error.message or ""))
	end
	raiseError("http", "HTTP " .. result.status .. " with unexpected body")
end

local function readWebRow(root: string): { url: string?, port: number? }
	local path = root .. "/.tasks/runtime.json"
	local ok, contents = pcall(function()
		if ternHost ~= nil then
			return ternHost.fs.read(path, 1048576)
		end
		if fsHost ~= nil then
			return fsHost.readFile(path)
		end
		return nil
	end)
	if not ok or typeof(contents) ~= "string" then
		return {}
	end
	local okDecode, registry = pcall(function()
		return json.decode(contents)
	end)
	if not okDecode or typeof(registry) ~= "table" then
		return {}
	end
	for _, row in registry :: any do
		if typeof(row) == "table" and row.kind == "web" and typeof(row.url) == "string" then
			return { url = row.url :: string, port = typeof(row.port) == "number" and row.port :: number or nil }
		end
	end
	return {}
end

-- Tern-only: bootstrap the web server for this workspace by spawning `tk web`
-- and parsing the printed URL from stdout (best-effort). `tern.process.run`
-- is async (Awaitable<ProcessResult>), so the parse runs in the :next hook.
-- `onReady(url)` receives the bootstrapped URL, or nil on any failure.
local function bootstrapUrl(root: string, onReady: (string?) -> ()): ()
	if ternHost == nil then
		onReady(nil)
		return
	end
	local ok, awaitable = pcall(function()
		return ternHost.process.run({ "tk", "web", "--json" }, { cwd = root })
	end)
	if not ok or typeof(awaitable) ~= "table" or typeof(awaitable.next) ~= "function" then
		onReady(nil)
		return
	end
	awaitable.next(function(result: any, err: string?, _cx: any)
		local url: string? = nil
		if result ~= nil and err == nil then
			local stdout = tostring(result.stdout or "")
			local okDecode, parsed = pcall(function()
				return json.decode(stdout)
			end)
			if okDecode and typeof(parsed) == "table" and typeof(parsed.url) == "string" then
				url = parsed.url :: string
			else
				local port = stdout:match("http://localhost:(%d+)") or stdout:match("http://127%.0%.0%.1:(%d+)")
				if port ~= nil then
					url = "http://localhost:" .. port
				end
			end
		end
		onReady(url)
	end)
end

-- Any HTTP answer proves the server is alive; only network-level failure
-- (status -1) means the registry row is stale.
local function probeStatus(url: string, timeoutMs: number): boolean
	local ok, res = pcall(function()
		return transportImpl.request("GET", url .. "/api/status", "", timeoutMs)
	end)
	if not ok then
		return false
	end
	return (res :: any).status ~= -1
end

export type Client = {
	root: string,
	url: string,
	port: number?,
	timeout_ms: number,
	interval_ms: number,
	id: number,
	call: (self: Client, method: string, params: { [string]: any }?) -> any,
	get: (self: Client, path: string) -> any,
} & { [string]: any }

export type ConnectOptions = {
	port: number?,
	timeout_ms: number?,
	interval_ms: number?,
	-- Tern-only: `tk web` bootstrap is async (tern.process.run -> Awaitable), so
	-- when the registry row is dead, construction completes in a :next hook.
	-- `connect` then returns a shell client that fills in later; `on_ready`
	-- fires with the real client once discovery finishes (nil url = failed,
	-- error also via on_discovery_error). lune always builds synchronously.
	on_ready: ((client: Client?) -> ())?,
	on_discovery_error: ((kind: string, message: string) -> ())?,
}

-- Tern-only continuation: registry row first (already probe-free under Tern —
-- the fetch probe is async and the server rejects unknown hosts anyway), then
-- async `tk web` bootstrap.
local function discoverAsync(root: string, options: ConnectOptions, continuation: (url: string?, port: number?) -> ()): ()
	local row = readWebRow(root)
	if row.url ~= nil and row.port ~= nil then
		continuation(row.url, row.port)
		return
	end
	bootstrapUrl(root, function(bootstrapped: string?)
		if bootstrapped == nil then
			local message = if ternHost ~= nil
				then "no live tk web server found in " .. root .. " and `tk web` bootstrap failed"
				else "no live tk web server found in " .. root .. " (stale or missing .tasks/runtime.json row)"
			if options.on_discovery_error ~= nil then
				options.on_discovery_error("discovery", message)
				return
			end
			raiseError("discovery", message)
			return
		end
		local retry = readWebRow(root)
		if retry.url ~= nil then
			continuation(retry.url, retry.port)
		else
			continuation(bootstrapped, nil)
		end
	end)
end

local function connect(root: string, opts: { port: number?, timeout_ms: number?, interval_ms: number? }?): any
	local options: ConnectOptions = opts or {}
	local onReady = options.on_ready
	local onDiscoveryError = options.on_discovery_error

	local call = function(self: any, method: string, params: { [string]: any }?): any
		self.id = self.id + 1
		local envelope = {
			v = wire.PROTOCOL_VERSION,
			id = tostring(self.id),
			method = method,
			params = params or {},
		}
		local result = transportImpl.request("POST", self.url .. "/api/rpc", json.encode(envelope), self.timeout_ms)
		if ternHost ~= nil then
			return result -- raw Awaitable<FetchResult>; caller awaits + normalizes + unwraps
		end
		return unwrap(result :: any)
	end

	local get = function(self: any, path: string): any
		local result = transportImpl.request("GET", self.url .. path, "", self.timeout_ms)
		if ternHost ~= nil then
			return result
		end
		return result
	end

	local build = function(url: string, port: number?): Client
		local client: Client = {
			root = root,
			url = url,
			port = port,
			timeout_ms = options.timeout_ms or DEFAULT_TIMEOUT_MS,
			interval_ms = options.interval_ms or DEFAULT_INTERVAL_MS,
			id = 0,
			call = call,
			get = get,
		}

		-- Per-verb helpers composed per instance: the domains close over the
		-- concrete client, so `client.issue.create` routes to `self:call`.
		local domains: { [string]: { [string]: any } } = {}
		for _, verb in wire.METHODS do
			local domain, name = verb:match("^(%w+)%.([%w]+)$")
			if domain ~= nil and name ~= nil then
				if domains[domain :: string] == nil then
					domains[domain :: string] = {}
				end
				local boundVerb = verb
				domains[domain :: string][name :: string] = function(params: { [string]: any }?): any
					return client:call(boundVerb, params)
				end
			end
		end
		for domain, verbs in domains do
			client[domain] = verbs
		end

		-- Connect-time hello + version check (synchronous hosts only; under Tern
		-- the same check fires in `unwrap` on the first resolved hello — the call
		-- here is a no-op unwrap-wise because `call` already unwrapped it).
		if ternHost == nil then
			client:call("hello", {})
		end

		return client
	end

	-- Explicit port skips discovery entirely.
	if options.port ~= nil then
		return build("http://localhost:" .. options.port, options.port)
	end

	if ternHost == nil then
		-- lune: synchronous discovery.
		local row = readWebRow(root)
		if row.url ~= nil and probeStatus(row.url :: string, DEFAULT_TIMEOUT_MS) then
			return build(row.url, row.port)
		end
		raiseError("discovery", "no live tk web server found in " .. root .. " (stale or missing .tasks/runtime.json row)")
		return nil :: any
	end

	-- Tern: the registry read is sync, but the `tk web` bootstrap is async, so
	-- construction completes in a :next hook via `on_discovery_error`/callback.
	local row = readWebRow(root)
	if row.url ~= nil then
		return build(row.url, row.port)
	end
	local clientHolder = clientTemplate()
	discoverAsync(root, options, function(url: string?, port: number?)
		if url == nil then
			if onReady ~= nil then
				onReady(nil)
			end
			return
		end
		local built = build(url, port)
		for key, value in built do
			clientHolder[key] = value
		end
		if onReady ~= nil then
			onReady(built)
		end
	end)
	return clientHolder
end

return {
	connect = connect,
	unwrap = unwrap,
}
