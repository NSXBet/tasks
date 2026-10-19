# TUI deep links — plan

Every page of the TUI is addressable at launch and from the CommandPalette
through one URI grammar: `tk tui 'tk://task/<id>'` boots the TUI into that
task; the same grammar jumps anywhere in-app. A new page becomes addressable
by adding one co-located route entry next to its component — forgetting it
fails typecheck. No per-feature flags, ever.

## Design decisions (confirmed 2026-10-18)

- **Boot deep-link delivery** — resolve the target before first render and
  boot `App` straight into that state. Not live IPC (stdin can't drive
  OpenTUI after first flush — 2026-10-15 lesson; also solves "drive", not
  "open") and not headless snapshot (automation tool, different product).
- **Address state, not widgets** — the addressable surface is `App.tsx`'s
  state slots, not the render tree. Row 3 doesn't exist; "selection = row 3"
  does. State addressing is this app's accessibility tree.
- **Full URI grammar** — `tk://<route>` with the scheme explicit from day
  one. Survives future OS protocol-handler integration unchanged: a
  registered handler also delivers the URI as argv.
- **Co-located route entries + type-enforced table** — the file-routing
  pattern (Next.js app router): the route exists because the page exists;
  the compiler, not discipline, keeps the table complete.
- **One resolver, two clients** — boot (`main.tsx` argv) and CommandPalette
  (`navigate` action) both call `resolveTarget`. In-app jump and shell launch
  share grammar and registry.
- **Generic `slot=value` addressing: cut (YAGNI)** — compiler enforcement
  already guarantees coverage; raw slot names would leak internals as public
  API.
- **Scope line** — deep links address *navigation/state* only. Mutations
  ("close issue", "assign") keep flowing through `@tasks/surface` ops and
  the CLI; never duplicated into the grammar.

## The grammar

```
tk://<route>[?param=value&…]
```

| URI | slots set | notes |
|---|---|---|
| `tk://task/<id>` | `detailId=<id>` | detail pane opens; view stays list |
| `tk://diff/<id>` | `detailId=<id>` + diff modal | |
| `tk://board/kanban` | `view=kanban` | |
| `tk://graph/<id>` | `view=graph`, `graphId=<id>` | |
| `tk://insights` | `view=insights` | |
| `tk://help` | `helpOpen=true` | |
| `tk://composer/<id>` | composer open for `<id>` | |

The table is illustrative — initial coverage, not a closed list. Route
owners register entries; overlays (diff modal, help, composer, task modal)
are addressable kinds just like views.

## Architecture

- `packages/tui/src/app/routes.ts` — `defineRoute`, `resolveTarget(query)`,
  the assembled route table.
- **Route entries co-located**: each view/overlay file exports its route
  next to the component it opens (`task.tsx` exports the `task` route);
  `routes.ts` imports and assembles. Locality of behavior.
- **Enforcement**: `type RouteTable = { [K in AddressableKind]: RouteEntry }`
  where `AddressableKind` = `ViewKind` ∪ overlay kinds. Adding a kind
  without a route → typecheck error. The union stays the source of truth,
  which it already is (`ViewKind`).
- **Boot path**: `runTui` (`packages/cli/src/tk.ts:851-862`) passes the
  target argv through to `main.tsx`; main parses, resolves, passes initial
  slot values to `App` as props (defaults otherwise).
- **Palette path**: `AppActions.navigate(query)` → `resolveTarget` → slot
  setters. One new action; no per-route actions.

## Resolution semantics

- **Boot, malformed URI** (unknown route, bad params): fail before render —
  stderr usage error, non-zero exit. Malformed input is a program error,
  not a UI state.
- **Boot, well-formed but missing data** (`tk://task/<unknown>`): apply
  slots anyway; after first board fetch, if the target is missing → toast +
  fall back to list. Boot is lenient because board data isn't loaded yet.
- **Palette**: resolves live against loaded data; unknown target → error
  toast, no state change.

## Non-goals

- OS protocol-handler registration (Info.plist / registry / .desktop) —
  future product; the grammar survives it unchanged (argv delivery).
- Live-IPC control of an already-running TUI.
- Headless render/snapshot mode.
- Generic `slot=value` raw addressing (cut — YAGNI).
- Web surface routing — the board already has URLs; `tkweb://` is reserved
  by convention only, not implemented.

## Testing

Via the `openTuiStore` + `testRender` seam; never pty (proc stdin injection
can't drive the OpenTUI app after first flush). Cover: each initial route
boots into its slots; malformed URI exits with usage error; unknown id
toasts and falls back to list; palette `navigate` applies the same routes.

## Phases

1. **Grammar + route table** — `defineRoute`, `AddressableKind`, co-located
   entries for existing views, `resolveTarget`, exhaustive-table typecheck.
2. **Boot path** — `runTui` argv pass-through, `main.tsx` parse/resolve,
   lenient post-fetch check, initial-slot props on `App`.
3. **Palette client** — `navigate` action; palette input routes through
   `resolveTarget`.
4. **Overlay coverage + tests** — diff, help, composer, task modal routes;
   full route test set.

## Open questions (learner's call at implementation time)

- Statusbar echoing the current address — free discoverability of the
  grammar, small surface cost.
- Bare-path sugar (`task/<id>` without scheme) in the palette — cut with the
  full-URI decision; revisit if typing pain shows up.
- Whether `?` params are needed at all day one — current routes are
  path-only.

## Outcome (2026-10-18)

All four phases implemented; tests 41/41 in packages/tui (39 pass + 2 fixed
below), both `check` scripts green.

- Delivered as planned: `routes.ts` resolver + co-located entries,
  boot argv pass-through (`tk tui [workspace] ['tk://route']`), lenient
  post-fetch missing-id toast, palette `tk://` submit.
- Additions beyond plan: `RouteEntry.accepts` — closed-enum params
  (composer mode) reject the link and fall to the unknown-route error
  instead of silently no-op'ing.
- Plan deltas: statusbar echo not built (open question stays open);
  `?` params parsed and tolerated by the resolver, unused by routes —
  matches the "path-only day one" leaning.
- **Regression found & fixed (not caused by this feature)**: an uncommitted
  `@opentui` 0.5.11→0.6.0 bump broke every `testRender` test (endless
  act() warnings, `waitForFrame` never resolves; HEAD worktree on 0.5.11
  passed the same test). Downgraded back to 0.5.11 — nothing in src uses
  0.6.0-only APIs. If the upgrade is retried, do it as its own phase with
  the render suite as the gate.
