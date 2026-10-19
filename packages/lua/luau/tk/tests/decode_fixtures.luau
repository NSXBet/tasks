--!strict
-- Villain fixtures for json.luau decode/encode and wire.luau typing assumptions.
-- Run: lune run packages/lua/luau/tk/tests/decode_fixtures.luau
-- Same plain-script convention as json_tests.luau (helper copied, not imported).
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

local function deepEqual(a: any, b: any): boolean
	if typeof(a) ~= typeof(b) then
		return false
	end
	if typeof(a) ~= "table" then
		return a == b
	end
	for k, v in pairs(a) do
		if not deepEqual(v, (b :: any)[k]) then
			return false
		end
	end
	for k, v in pairs(b) do
		if not deepEqual(v, (a :: any)[k]) then
			return false
		end
	end
	return true
end

-- ---------------------------------------------------------------------------
-- Empty containers
-- ---------------------------------------------------------------------------

check("empty array and empty object both decode to an empty table", function()
	local arr = json.decode("[]")
	local obj = json.decode("{}")
	assert(typeof(arr) == "table" and next(arr) == nil)
	assert(typeof(obj) == "table" and next(obj) == nil)
	-- Documented ambiguity: Lua cannot distinguish [] from {} after decode.
	assert(deepEqual(arr, obj))
end)

check("array of objects survives decode", function()
	local r = json.decode('[{"id":"TK-1","title":"a"},{"id":"TK-2","title":"b"}]')
	assert(#r == 2)
	assert(r[1].id == "TK-1" and r[2].title == "b")
	local t = json.decode('{"items":[{},{"k":1}]}')
	assert(next(t.items[1]) == nil and t.items[2].k == 1)
end)

-- ---------------------------------------------------------------------------
-- Null object members
-- ---------------------------------------------------------------------------

check("null object members are dropped (key absent, not sentinel)", function()
	local r = json.decode('{"id":"TK-1","parent":null,"assignee":null,"title":"x"}')
	assert(r.id == "TK-1" and r.title == "x")
	assert(r.parent == nil)
	assert(r.assignee == nil)
	assert(rawget(r, "parent") == nil, "key must be absent from the table, not a sentinel")
	assert(json.is_null(r.parent) == false)
end)

check("nested null members dropped; sibling keys survive", function()
	local r = json.decode('{"issue":{"title":"x","due":null},"counts":{"open":3}}')
	assert(r.issue.title == "x" and r.issue.due == nil)
	assert(r.counts.open == 3)
end)

-- ---------------------------------------------------------------------------
-- Null array items: holes
-- ---------------------------------------------------------------------------

check("null array items become holes; # and [i] behavior", function()
	local r = json.decode('[1,null,3,null,5]')
	assert(r[1] == 1 and r[3] == 3 and r[5] == 5)
	assert(r[2] == nil and r[4] == nil)
	assert(#r == 5, "length tracks the last numeric key even with interior holes")
	local seen = 0
	for _ in ipairs(r) do
		seen += 1
	end
	assert(seen == 1, "ipairs stops at the first hole")
end)

check("trailing null collapses the sequence (serde quirk, pinned)", function()
	-- Interior holes keep the border (`[1,null,3]` -> # == 3) because serde
	-- writes index 3; a trailing null is not written at all, so `["a",null]`
	-- decodes to # == 1. Callers relying on length must not assume it counts
	-- trailing nulls.
	local r = json.decode('["a",null]')
	assert(#r == 1 and r[1] == "a" and r[2] == nil)
end)

check("roundtrip: encode(decode(array with null items)) preserves nulls, exact form", function()
	local s = '[1,null,"x"]'
	local out = json.encode(json.decode(s))
	-- Decode turns null items into nil holes; the encoder (serde path, holes
	-- preserved as null; sentinel-free so containsNull is false) re-emits null.
	assert(out == s, "got " .. out)
end)

check("roundtrip loses TRAILING nulls (pinned, follows from the trailing-hole quirk)", function()
	-- `["a",null]` decodes to a length-1 sequence, so the re-encoded form
	-- drops the trailing null: null -> absent is lossy at the sequence tail.
	local out = json.encode(json.decode('["a",null]'))
	assert(out == '["a"]', "got " .. out)
end)

check("roundtrip with explicit null() sentinel pins exact encoded form", function()
	local v = { json.null(), 2, json.null() }
	local s = json.encode(v)
	assert(s == "[null,2,null]", "got " .. s)
	-- Decoding that back yields holes; re-encode preserves interior holes but
	-- the trailing null collapses (same quirk as above).
	assert(json.encode(json.decode(s)) == "[null,2]", "got " .. json.encode(json.decode(s)))
end)

-- ---------------------------------------------------------------------------
-- Unicode
-- ---------------------------------------------------------------------------

check("emoji and combining marks survive decode->encode roundtrip", function()
	local s = '"emoji 🎉🚀 and combining é and z w alliances" '
	local original = '"emoji 🎉🚀 and combining é and z an lat"'
	local decoded = json.decode(original)
	assert(typeof(decoded) == "string")
	local re = json.encode(decoded)
	assert(json.decode(re) == decoded)
	-- codepoints intact: compare against a hand-built marker
	assert(decoded:find("🎉", 1, true) ~= nil)
	assert(json.decode(s) ~= nil) -- the control string itself is valid JSON
end)

check("escaped unicode in JSON decodes to the same string as raw UTF-8", function()
	local a = json.decode('"\\ud83c\\udf89"') -- surrogate pair for 🎉
	assert(a == "🎉")
end)

-- ---------------------------------------------------------------------------
-- Big integers (f64 precision, documented)
-- ---------------------------------------------------------------------------

-- json.luau decodes through serde, which maps JSON numbers to Lua numbers
-- (f64). Integers beyond 2^53 lose precision; nothing in json.luau exposes
-- large-int-as-decimal-text, so precision loss is the pinned contract.
check("2^53-1 survives exactly; 2^53+1 does not", function()
	assert(json.decode('9007199254740991') == 9007199254740991)
	assert(json.decode('9007199254740993') == 9007199254740992,
		"2^53+1 rounds down to 2^53 under f64")
end)

check("f64-exact big integers survive: 2^62 and negatives", function()
	assert(json.decode('4611686018427387904') == 2 ^ 62)
	assert(json.decode('-4611686018427387904') == -2 ^ 62)
end)

check("encoding an exact f64 integer re-emits full digits", function()
	local s = json.encode(4611686018427387904)
	assert(s == "4611686018427387904", "got " .. s)
end)

-- ---------------------------------------------------------------------------
-- Missing fields / nullable params (wire.luau typing assumptions)
-- ---------------------------------------------------------------------------

check("partial issue object: missing fields read as nil on typed-ish tables", function()
	-- wire.luau result types are `any`, so nothing enforces presence; the
	-- contract is that callers must nil-check optional fields.
	local r = json.decode('{"id":"TK-1","title":"x","status":"open"}')
	assert(r.priority == nil and r.assignee == nil and r.parentId == nil and r.due == nil)
end)

check("nullable string param encodes via json.null() to JSON null (P_issue_list.parent)", function()
	-- wire.luau's contract marks `parent` nullable on issue.list/issue.update
	-- (the server accepts `parent: null` as an explicit filter). The sentinel
	-- is how a Luau caller distinguishes "not filtering" (key absent) from
	-- "filter for null parent" (key present, JSON null).
	local params: any = { parent = json.null(), status = "open" }
	local s = json.encode(params)
	assert(s == '{"parent":null,"status":"open"}', "got " .. s)
	-- is_null() roundtrip for callers checking what they built
	assert(json.is_null(params.parent) == true)
	-- contrast: absent key must NOT encode as null
	assert(json.encode({ status = "open" }) == '{"status":"open"}')
end)

check("null() as param value decodes back to absent member", function()
	local s = json.encode({ parent = json.null() })
	local r = json.decode(s)
	assert(r.parent == nil, "server sees no parent key — matches optNullOrStr handling")
end)

-- ---------------------------------------------------------------------------
-- Realistic server value shapes (packages/surface issue shape)
-- ---------------------------------------------------------------------------

check("issue.list item: full shape decodes with labels array and nulls dropped", function()
	local payload = [[
[
  {
    "id": "TK-1",
    "title": "Wire the Lua client",
    "status": "open",
    "type": "task",
    "priority": 2,
    "assignee": "yuri",
    "owner": null,
    "parentId": null,
    "sprintId": "s-2026w42",
    "labels": ["bridge", "lua"],
    "createdAt": "2026-10-19T10:00:00Z",
    "updatedAt": "2026-10-19T12:34:56Z"
  },
  {
    "id": "TK-2",
    "title": "Doc the transport",
    "status": "closed",
    "type": "task",
    "labels": []
  }
]
]]
	local items = json.decode(payload)
	assert(#items == 2)
	assert(items[1].id == "TK-1" and items[1].priority == 2)
	assert(items[1].owner == nil and items[1].parentId == nil) -- nulls dropped
	assert(items[1].labels[1] == "bridge" and #items[1].labels == 2)
	-- TK-2 has no owner/assignee keys at all: nil access is the caller's nil-check
	assert(items[2].assignee == nil and items[2].owner == nil and items[2].priority == nil)
	assert(#items[2].labels == 0)
end)

check("issue.get value: nullable description + comments array decode", function()
	local payload = [[
{
  "id": "TK-1",
  "title": "Wire the Lua client",
  "status": "open",
  "description": null,
  "notes": null,
  "labels": [],
  "comments": [
    { "id": "c1", "body": "first", "at": "2026-10-19T11:00:00Z" },
    { "id": "c2", "body": "émoji 🎉 reply", "at": "2026-10-19T11:05:00Z" }
  ]
}
]]
	local v = json.decode(payload)
	assert(v.id == "TK-1" and v.description == nil and v.notes == nil)
	assert(#v.comments == 2)
	assert(v.comments[2].body == "émoji 🎉 reply")
end)

check("board.get-style events value decodes with dropped null members", function()
	local payload = [[
{
  "columns": [
    { "name": "ready", "issues": [{ "id": "TK-1", "title": "a" }] },
    { "name": "wip", "issues": [], "filter": null }
  ],
  "updatedAt": "2026-10-19T12:00:00Z"
}
]]
	local v = json.decode(payload)
	assert(#v.columns == 2)
	assert(v.columns[1].issues[1].id == "TK-1")
	assert(#v.columns[2].issues == 0)
	assert(v.columns[2].filter == nil)
end)

print("decode_fixtures: all passed")
