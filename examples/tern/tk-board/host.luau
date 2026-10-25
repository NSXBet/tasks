--!strict
-- tk Board: a live block of this workspace's tk issues.
--
-- Data path (vendored tk Luau client, lib/tk/):
--   discovery  client.connect(root) reads <root>/.tasks/runtime.json for the
--              daemon's hosted-web row; root is found by walking up from cx.cwd
--   reads      issue.list via the hand-written verb helpers (wire.luau)
--   refresh    events.subscribe marks dirty on issue.* events and resyncs; a
--              debounced timer refetches once per burst
--   errors     event-loop failures toast and keep polling; fetch failures land
--              in an inline error card; key `r` forces a refetch

local client_mod = require("./lib/tk/client")
local transport = require("./lib/tk/transport")
local events = require("./lib/tk/events")

local MAX_ROWS = 24
local RECONCILE_DELAY_MS = 250
local POLL_INTERVAL_MS = 2000

local PRIORITY_LABEL: { [number]: string } = { [0] = "P0", [1] = "P1", [2] = "P2", [3] = "P3", [4] = "P4" }
local STATUS_TONE: { [string]: string } = {
	open = "success",
	in_progress = "accent",
	blocked = "warning",
	deferred = "muted",
	closed = "muted",
	archived = "muted",
}
local STATUS_ORDER: { [string]: number } = {
	in_progress = 1,
	open = 2,
	blocked = 3,
	deferred = 4,
	closed = 5,
	archived = 6,
}

type Row = { id: string, title: string, status: string, priority: number?, assignee: string? }

type State = {
	phase: "connecting" | "ready" | "error",
	error: string?,
	root: string?,
	client: any?,
	rows: { Row },
	fetch_pending: boolean,
	dirty: boolean,
}

local function findRoot(cwd: string?): string?
	local dir = cwd
	if dir == nil then
		return nil
	end
	for _ = 1, 8 do
		local ok, hit = pcall(function()
			return tern.fs.exists(dir .. "/.tasks/runtime.json")
		end)
		if ok and hit then
			return dir
		end
		local parent = dir:match("^(.+)/[^/]+$")
		if parent == nil then
			return nil
		end
		dir = parent
	end
	return nil
end

local function reconcile(state: State, cx: BlockCx): ()
	local client = state.client
	if client == nil or state.fetch_pending then
		return
	end
	state.fetch_pending = true
	(client:call("issue.list", {})):next(function(raw: any?, err: string?, _windowCx: WindowCx?)
		state.fetch_pending = false
		if err ~= nil then
			state.error = err
			state.phase = "error"
			cx:toast("error", "tk board: " .. err)
			cx:render()
			return
		end
		local ok, value = pcall(function()
			return client_mod.unwrap(transport.tern.normalize(raw))
		end)
		if not ok then
			state.error = tostring(value)
			state.phase = "error"
			cx:render()
			return
		end
		state.error = nil
		state.rows = value :: { Row }
		state.phase = "ready"
		cx:render()
	end)
end

local function markDirty(state: State, cx: BlockCx): ()
	if state.dirty then
		return
	end
	state.dirty = true
	tern.timer(RECONCILE_DELAY_MS, function()
		if state.dirty then
			state.dirty = false
			reconcile(state, cx)
		end
	end)
end

local function subscribeEvents(state: State, cx: BlockCx): ()
	events.subscribe(state.client :: any, {
		interval_ms = POLL_INTERVAL_MS,
		on_event = function(ev: any)
			local kind = tostring(ev.kind or "")
			if kind:sub(1, 6) == "issue." then
				markDirty(state, cx)
			end
		end,
		on_resync = function()
			markDirty(state, cx)
		end,
		on_error = function(msg: string)
			-- The poll loop keeps running; surface the failure without tearing down the board.
			cx:toast("error", "tk board events", msg)
		end,
	})
end

local function boardView(state: State): BlockView
	local ui = tern.ui
	if state.phase == "error" then
		return {
			main = ui.col({
				ui.card("tk board — error", {
					ui.text(state.error or "unknown error"),
					ui.text("check that `tk web` is hosting this workspace"),
				}),
			}),
		}
	end
	if state.phase == "connecting" then
		return {
			main = ui.col({
				ui.card("tk board", {
					ui.text("connecting" .. (state.root and (" — " .. state.root) or "") .. "…"),
				}),
			}),
		}
	end

	local rows = state.rows
	table.sort(rows, function(a: Row, b: Row)
		local sa = STATUS_ORDER[a.status] or 9
		local sb = STATUS_ORDER[b.status] or 9
		if sa ~= sb then
			return sa < sb
		end
		local pa = a.priority or 2
		local pb = b.priority or 2
		if pa ~= pb then
			return pa < pb
		end
		return a.id < b.id
	end)

	local cells: { { Span | string } } = {}
	local shown = 0
	for _, r in rows do
		if r.status ~= "closed" and r.status ~= "archived" then
			if shown >= MAX_ROWS then
				break
			end
			shown += 1
			table.insert(cells, {
				r.id,
				r.status:gsub("_", " "),
				PRIORITY_LABEL[r.priority or 2] or "—",
				r.assignee or "",
				r.title,
			})
		end
	end

	local parts: { Node } = {}
	local total = 0
	for _, r in rows do
		if r.status ~= "closed" and r.status ~= "archived" then
			total += 1
		end
	end
	table.insert(parts, ui.table({
		{ id = "id", head = "ID", priority = 3 },
		{ id = "status", head = "Status", priority = 3 },
		{ id = "pri", head = "Pri", priority = 3 },
		{ id = "assignee", head = "Assignee", priority = 4 },
		{ id = "title", head = "Title", priority = 1, grow = 1 },
	}, cells))
	if total > shown then
		table.insert(parts, ui.text({ ui.span(("+%d more"):format(total - shown), "muted") }))
	end

	return {
		main = ui.col({
			ui.card({ ui.span("tk board"), ui.span(("  %d/%d"):format(shown, total), "muted") }, parts),
		}),
	}
end

tern.block.define("board", {
	init = function(cx: BlockCx, _args: { string }, _saved: any): State
		local state: State = {
			phase = "connecting",
			error = nil,
			root = nil,
			client = nil,
			rows = {},
			fetch_pending = false,
			dirty = false,
		}
		local root = findRoot(cx.cwd)
		if root == nil then
			state.phase = "error"
			state.error = "no .tasks workspace found above " .. (cx.cwd or "unknown cwd")
			return state
		end
		state.root = root
		local ok, client = pcall(function()
			return client_mod.connect(root)
		end)
		if not ok then
			state.phase = "error"
			state.error = tostring(client)
			return state
		end
		state.client = client
		reconcile(state, cx)
		subscribeEvents(state, cx)
		return state
	end,

	view = function(state: State, _cx: BlockCx): BlockView
		return boardView(state)
	end,

	title = function(state: State): string?
		local active = 0
		for _, r in state.rows do
			if r.status == "open" or r.status == "in_progress" or r.status == "blocked" then
				active += 1
			end
		end
		if state.phase == "error" then
			return "tk board — error"
		end
		if state.phase == "connecting" then
			return "tk board — connecting"
		end
		return ("tk board (%d)"):format(active)
	end,

	key = function(state: State, key: Key, cx: BlockCx): boolean?
		if key.name == "r" and state.phase ~= "connecting" then
			reconcile(state, cx)
			return true
		end
		return false
	end,

	save = function(_state: State): any
		return nil
	end,
})
