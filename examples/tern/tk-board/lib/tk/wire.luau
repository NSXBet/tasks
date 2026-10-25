--!strict
-- RPC contract for the tk web server — hand-written Luau.
--
-- The contract between this library and the TypeScript daemon is the HTTP RPC
-- surface itself (POST /api/rpc with `{ v, id, method, params }` envelopes) and
-- the verb table below. The verb list mirrors the tk CLI command surface —
-- every command the CLI drives maps to one `call(verb, params)` here. When the
-- daemon's verb table changes, update this file by hand: add/remove the verb
-- and bump VERBS_VERSION (and PROTOCOL_VERSION only if the envelope itself
-- changed). The server's `hello` verdict reports both versions; `client.call`
-- refuses to talk to a mismatched server.
--
-- Params are plain Luau tables serialized with `json.luau`; no per-verb schema
-- is declared here — the server validates and surfaces structured errors, which
-- surface through `client:call` unchanged.

local PROTOCOL_VERSION = 2
local VERBS_VERSION = 2

-- Verb ids in the daemon's verb-table declaration order.
local METHODS: { string } = {
	"hello",
	"board.get",
	"issue.create",
	"issue.show",
	"issue.list",
	"issue.ready",
	"issue.blocked",
	"issue.search",
	"issue.query",
	"issue.stale",
	"issue.orphans",
	"issue.children",
	"issue.epic",
	"issue.update",
	"issue.status",
	"issue.finish",
	"issue.defer",
	"issue.undefer",
	"issue.archive",
	"issue.unarchive",
	"issue.claim",
	"issue.assign",
	"issue.priority",
	"issue.labelAdd",
	"issue.labelRemove",
	"issue.note",
	"issue.duplicate",
	"issue.supersede",
	"issue.closeMany",
	"issue.rename",
	"issue.delete",
	"issue.attach",
	"issue.detach",
	"issue.detachBlob",
	"issue.comments",
	"issue.comment",
	"deps.list",
	"deps.add",
	"deps.remove",
	"deps.link",
	"sprint.list",
	"sprint.start",
	"sprint.close",
	"sprint.add",
	"sprint.remove",
	"sprint.move",
	"views.all",
	"views.counts",
	"views.stats",
	"views.tree",
	"views.graph",
	"views.duplicates",
	"views.lint",
	"runtime.list",
	"runtime.activity",
	"inbox.list",
	"inbox.read",
	"inbox.archive",
}

-- Cheap self-check: every verb is a bare word or `domain.action`, so malformed
-- entries fail loudly at require time instead of as mystery 404s.
for _, verb in METHODS do
	local valid = verb:match("^(%a+)%.(%a+)$") ~= nil or verb:match("^%a+$") ~= nil
	assert(valid, "invalid verb id in wire.METHODS: " .. verb)
end

local set: { [string]: boolean } = {}
for _, verb in METHODS do
	set[verb] = true
end

return {
	PROTOCOL_VERSION = PROTOCOL_VERSION,
	VERBS_VERSION = VERBS_VERSION,
	METHODS = METHODS,
	IS_METHOD = set,
}
