--!strict
-- JSON shim for the tk Luau client (Tern plugins and lune tests).
--
-- Backed by `tern.json` when the Tern host is present, otherwise by lune's
-- `@lune/serde` (the require is pcall-gated so it is never reached under Tern).
--
-- API:
--   null()      -> sentinel (the host's null marker; encode emits it as JSON null)
--   is_null(v)  -> true when v is a null sentinel (host's or ours)
--   encode(v)   -> JSON string (empty table encodes as `{}`; on lune, tables
--                  containing the null sentinel take a null-aware pure encoder
--                  because serde cannot inject nulls into a table)
--   decode(s)   -> table (null object members are DROPPED, mirroring tern.json;
--                  JSON arrays become sequence tables — null array items become
--                  holes; numbers outside i64 lose precision to f64)
--
-- NOTE on both hosts: Lua cannot distinguish an absent member from a null
-- member after decode. Nullable presence is the caller's problem.

local nullSentinels: { [any]: boolean } = {}

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

local serdeHost: any = nil
if ternHost == nil then
	local ok, v = pcall(function()
		return require("@lune/serde")
	end)
	if ok then
		serdeHost = v
	end
end
if ternHost == nil and serdeHost == nil then
	error("tk.json: no host JSON backend found (expected tern.json or lune @lune/serde)", 0)
end

if ternHost ~= nil then
	nullSentinels[ternHost.json.null] = true
end

local ownNull = setmetatable({}, {
	__tostring = function()
		return "json.null"
	end,
})
nullSentinels[ownNull] = true

local function is_null(v: any): boolean
	return nullSentinels[v] == true
end

local function null(): any
	if ternHost ~= nil then
		return ternHost.json.null
	end
	return ownNull
end

-- ---------------------------------------------------------------------------
-- lune encode: serde.encode handles plain values; the null sentinel needs a
-- pure encoder because serde cannot represent null inside a table.
-- ---------------------------------------------------------------------------

local escapeChars: { [string]: string } = {
	['"'] = '\\"',
	["\\"] = "\\\\",
	["\b"] = "\\b",
	["\f"] = "\\f",
	["\n"] = "\\n",
	["\r"] = "\\r",
	["\t"] = "\\t",
}

local function encodeString(s: string): string
	local out = s:gsub('["\\\b\f\n\r\t]', escapeChars):gsub("[%c]", function(c)
		return string.format("\\u%04x", string.byte(c))
	end)
	return '"' .. out .. '"'
end

local function encodeNumber(n: number): string
	if n ~= n or n == math.huge or n == -math.huge then
		error("tk.json.encode: cannot encode NaN or infinity", 0)
	end
	if n == math.floor(n) and math.abs(n) < 2 ^ 53 then
		return string.format("%d", n)
	end
	return string.format("%.14g", n)
end

-- Mirrors tern.json ("tables with keys 1..n become arrays") and serde
-- ("{}" -> object): array = numeric keys only, starting at 1. Numeric holes
-- (from decoding `[1, null, 2]`) encode back as null; string keys make an
-- object (numeric keys stringified); mixed tables are objects.
local function encodeValue(v: any): string
	local vt = typeof(v)
	if v == nil or vt == "nil" then
		return "null"
	elseif is_null(v) then
		return "null"
	elseif vt == "boolean" then
		return v and "true" or "false"
	elseif vt == "number" then
		return encodeNumber(v)
	elseif vt == "string" then
		return encodeString(v)
	elseif vt == "table" then
		local hasStringKey = false
		local maxN = 0
		for k in pairs(v) do
			if typeof(k) == "string" then
				hasStringKey = true
			elseif typeof(k) == "number" and k > maxN then
				maxN = k
			end
		end
		if not hasStringKey and maxN > 0 then
			-- array: 1..maxN, holes become null (nulls were dropped by decode)
			local parts = {}
			for i = 1, maxN do
				parts[i] = encodeValue(v[i])
			end
			return "[" .. table.concat(parts, ",") .. "]"
		end
		-- object: string keys, numeric keys stringified, nil/null values emitted
		local parts = {}
		-- deterministic order when possible
		local keys = {}
		for k in pairs(v) do
			table.insert(keys, k)
		end
		table.sort(keys, function(a, b)
			return tostring(a) < tostring(b)
		end)
		for _, k in keys do
			local value = v[k :: any]
			if value ~= nil then
				local keyStr = if typeof(k) == "string" then k else tostring(k)
				table.insert(parts, encodeString(keyStr) .. ":" .. encodeValue(value))
			end
		end
		return "{" .. table.concat(parts, ",") .. "}"
	else
		error("tk.json.encode: cannot encode value of type " .. vt, 0)
	end
end

local function containsNull(v: any, depth: number): boolean
	if is_null(v) then
		return true
	end
	if depth <= 0 or typeof(v) ~= "table" then
		return false
	end
	for _, value in pairs(v) do
		if containsNull(value, depth - 1) then
			return true
		end
	end
	return false
end

local function encode(v: any): string
	if ternHost ~= nil then
		-- tern.json.encode handles tern.json.null natively; tables with keys
		-- 1..n become arrays.
		return ternHost.json.encode(v)
	end
	if containsNull(v, 64) then
		return encodeValue(v)
	end
	local ok, result = pcall(function()
		return serdeHost.encode("json", v)
	end)
	if not ok then
		error("tk.json.encode: " .. tostring(result), 0)
	end
	return result
end

local function decode(s: string): any
	if ternHost ~= nil then
		return ternHost.json.decode(s)
	end
	local ok, result = pcall(function()
		return serdeHost.decode("json", s)
	end)
	if not ok then
		error("tk.json.decode: " .. tostring(result), 0)
	end
	return result
end

return {
	null = null,
	is_null = is_null,
	encode = encode,
	decode = decode,
}
