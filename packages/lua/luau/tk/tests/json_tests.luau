--!strict
-- Lune tests for the tk JSON shim. Run: lune run packages/lua/luau/tk/tests/json_tests.luau
-- Poc convention: plain scripts, asserts abort with a Lua error (lune exits nonzero).
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

check("decode object", function()
	local r = json.decode('{"a":1,"b":"x","c":[1,2],"d":{"e":true}}')
	assert(r.a == 1 and r.b == "x" and r.c[2] == 2 and r.d.e == true)
end)

check("decode drops null object members (mirrors tern.json)", function()
	local r = json.decode('{"a":1,"b":null,"c":{"n":null,"v":2}}')
	assert(r.a == 1)
	assert(r.b == nil)
	assert(r.c.v == 2)
	assert(r.c.n == nil)
end)

check("decode array becomes sequence; null item becomes a hole", function()
	local r = json.decode('[1,null,3]')
	assert(r[1] == 1 and r[3] == 3)
	assert(#r == 3)
end)

check("decode rejects bad json", function()
	local ok = pcall(function()
		return json.decode("{bad")
	end)
	assert(not ok, "expected error on invalid json")
end)

check("decode rejects empty input", function()
	local ok = pcall(function()
		return json.decode("")
	end)
	assert(not ok, "expected error on empty input")
end)

check("encode roundtrip (no nulls) via serde", function()
	local v = { a = 1, b = "x", c = { 1, 2, 3 }, d = { e = true } }
	assert(deepEqual(json.decode(json.encode(v)), v))
end)

check("encode empty table is an object", function()
	assert(json.encode({}) == "{}")
end)

check("encode null sentinel emits json null and decode drops it", function()
	local v = { a = 1, b = json.null(), c = { json.null(), 2 } }
	local s = json.encode(v)
	assert(s == '{"a":1,"b":null,"c":[null,2]}', "got " .. s)
	local r = json.decode(s)
	assert(r.a == 1 and r.b == nil and r.c[2] == 2)
end)

check("is_null recognizes the sentinel and rejects everything else", function()
	assert(json.is_null(json.null()) == true)
	assert(json.is_null(nil) == false)
	assert(json.is_null(false) == false)
	assert(json.is_null("null") == false)
	assert(json.is_null({}) == false)
end)

check("null() returns a stable sentinel", function()
	assert(json.null() == json.null())
end)

check("decode number precision: outside i64 becomes float (documented loss)", function()
	local r = json.decode('{"n":9007199254740993}')
	assert(r.n == 9007199254740992, "expected f64 precision loss")
end)

print("json_tests: all passed")
