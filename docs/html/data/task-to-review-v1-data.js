window.DATA = window.DATA || {};
window.DATA.taskAsPrV1 = {
  "meta": {
    "date": "2026-10-19",
    "repo": "NSXBet/tasks",
    "workspace": "92 issues · 51 open · 6 wip · 9 review · 26 done",
    "tui": "bun packages/tui/src/main.ts (live session, workspace = this repo)",
    "web": "bun packages/web/src/main.ts (live, port 8787)",
    "prints": ".agents/tests/tui-test-v1-compare/prints"
  },
  "prints": [
    {
      "id": "01",
      "file": "01-list.txt",
      "where": "tui",
      "surface": "Views rail + list view",
      "mock": "§2 · rail tabs with counts, list rows priority/status/id/title/age",
      "refs": null,
      "verdict": "match",
      "note": "All 7 views present with live counts (List 92 · Board 66 · Graph 28 · Artifacts · Diff 1); footer keybar 1-4 views · : commands · ? keys.",
      "spec": "§2 · rail tabs with counts, list rows priority/status/id/title/age",
      "body": "┌────────────────┐ all            wip\n│VIEWS           │⚡ P2 open tasks-1 hello 18h                      ▀\n│▎ 1 ≡ List    92│✓ P1 closed tasks-11p Agent domain schema a… 26d\n│  2 ▦ Board   66│⛔ P2 open tasks-1zjy task→review step 12: … 8d\n│  3 ⟐ Graph   28│👀 P2 ready… tasks-2 hello 2 1mo\n│  4 ◎ Insights  │👀 P2 ready… tasks-27e root-plugin-quick-pro… 1mo\n│  5 ❐ Task      │· P2 in_pr… tasks-2n9g Luau codegen: generat… 7m\n│  6 ▤ Artifacts3│✓ P2 closed tasks-2ou hy 14d\n│  7 ± Diff     1│✓ P2 closed tasks-2ud Add first-class sprin… 26d\n│                │⚡ P3 open tasks-34rm Tasks — draft tasks, … 3d\n│ACTIONS         │⚡ P2 open tasks-5aj typebox-import-probe 1mo 💬1\n│ n ✎ new        │✓ P2 closed tasks-5aof TUI dev loop PoC — re… 1d\n│ / ⌕ search     │⚡ P2 open tasks-5e0 surface-import-probe 1mo\n│: ≡ commands    │✓ P2 closed tasks-5so x 1mo\n│ ? ⎇ keys       │⚡ P3 open tasks-6zif Team / cloud — access… 3d\n│                │✓ P2 closed tasks-71yd task→review step 4: p… 6h\n│                │⚡ P2 open tasks-75gw Decide default worktr… 7h\n│                │⛔ P2 ready… tasks-7twa tui deep links: route…\n│                │· P2 in_pr… tasks-861t Events ring buffer + … 7m\n│                │⚡ P2 open tasks-8ib session bridge probe 1mo\n│                │⛔ P2 open tasks-8is CLI evidence surface:… 14d\n│                │⚡ P2 open tasks-9f6 hello 3 1mo\n│                │⚡ P2 open tasks-9vx hy2 1mo\n│                │✓ P1 closed tasks-acz Domain: blob-backed e… 14d\n│                │⚡ P2 open tasks-b2g cutover smoke test 1mo\n│                │· P2 in_pr… tasks-c7ct Tern Lua bridge: Luau… 7m\n│                │⚡ P2 open tasks-caf cutover smoke test 1mo\n│                │⛔ P2 ready… tasks-cc41 tui deep links: boot …\n│                │⛔ P2 open tasks-cosq Integration: bun boot… 8m\n│                │⚡ P2 open tasks-cpi post-fix quick probe 1mo\n│                │⛔ P2 open tasks-cs9n Gate: full bun test +… 8m\n│                │⚡ P2 open tasks-cth the child 1mo\n│                │⚡ P3 open tasks-d0rq Review machinery — re… 3d\n│                │✓ P1 closed tasks-dwu Agent persistence acr… 26d\n│                │⛔ P2 open tasks-e0kg task→review step 10: … 8d\n│                │✓ P2 closed tasks-etqk task→review step 5: l… 6h\n│                │👀 P2 ready… tasks-foo task→review step 1: m… 8d\n│                │⛔ P2 open tasks-frux Luau events.luau: sub… 8m\n│yuri            │⛔ P2 ready… tasks-gqwr tui deep links: palet…\n└────────────────┘  open 51 · wip 6 · rev 9 · blk 21 · done 26                         1-4 views · : commands · ? keys"
    },
    {
      "id": "02",
      "file": "02-board.txt",
      "where": "tui",
      "surface": "Board — 4-column kanban",
      "mock": "§2 · Open / In Progress / Review / Closed columns",
      "refs": null,
      "verdict": "match",
      "note": "Column counts (51/6/9/26) and ⛔ blocked chips render per card; review column shows 💬 comment counts.",
      "spec": "§2 · Open / In Progress / Review / Closed columns",
      "body": "┌────────────────┐╭─ Open (51) ⛔18 ──────╮ ╭─ In Progress (6) ────╮ ╭─ Review (9) ⛔3 ──────╮ ╭─ Closed (26) ⛔2 ────╮\n│VIEWS           ││ 📋 ⚡ tasks-wwu P1   ▀│ │ 📋 · tasks-c7ct P2   │ │ 📋 ⛔ tasks-7twa P2  █│ │ 📋 ✓ tasks-acz P1    ▀\n│  1 ≡ List    92││ BlobStore port + fs   │ │ Tern Lua bridge: Luau│ │ tui deep links: route█│ │ Domain: blob-backed\n│▎ 2 ▦ Board   66││ adapter…              │ │ clien…               │ │ tests                █│ │ evidenc…\n│  3 ⟐ Graph   28││ 14d ago ·             │ │ 7m ago · #tern-lua   │ │ 16h ago · ⛔ · 💬1   █│ │ 14d ago · #attachmen\n│  4 ◎ Insights  ││ #attachments          │ │                      │ │                      █│ │\n│  5 ❐ Task      ││                       │ │ 📋 · tasks-h0xl P2   │ │ 📋 ⛔ tasks-gqwr P2  █│ │\n│  6 ▤ Artifacts3││ 📋 ⛔ tasks-ti3g P2   │ │ Luau transport.luau  │ │ tui deep links:      █│ │ 📋 ✓ tasks-jj6 P1\n│  7 ± Diff     1││ Example Tern plugin   │ │ seam: t…             │ │ palette nav…         █│ │ e2e smoke issue\n│                ││ tk-boar…              │ │ 7m ago · #tern-lua   │ │ 16h ago · ⛔ · 💬1   █│ │ 26d ago\n│ACTIONS         ││ 8m ago · #tern-lua ·  │ │                      │ │                      █│ │\n│ n ✎ new        ││ ⛔                    │ │ 📋 · tasks-x42o P2   │ │ 📋 ⛔ tasks-cc41 P2  █│ │ 📋 ✓ tasks-jbf P1\n│ / ⌕ search     ││                       │ │ Luau json.luau host  │ │ tui deep links: boot █│ │ Status-driven agent\n│: ≡ commands    ││ 📋 ⛔ tasks-cs9n P2   │ │ shim (t…             │ │ path (…              █│ │ executi…\n│ ? ⎇ keys       ││ Gate: full bun test + │ │ 7m ago · #tern-lua   │ │ 16h ago · ⛔ · 💬1   █│ │ 26d ago\n│                ││ docs …                │ │                      │ │                      █│ │\n│                ││ 8m ago · #tern-lua ·  │ │ 📋 · tasks-2n9g P2   │ │ 📋 👀 tasks-xsbt P2  █│ │ 📋 ✓ tasks-pmj P1\n│                ││ ⛔                    │ │ Luau codegen:        │ │ tui deep links:      █│ │ Run lifecycle CLI\n│                ││                       │ │ generator emi…       │ │ grammar + r…         █│ │ 26d ago\n│                ││ 📋 ⛔ tasks-cosq P2   │ │ 7m ago · #tern-lua   │ │ 16h ago · 💬1        █│ │\n│                ││ Integration: bun      │ │                      │ │                       │ │ 📋 ✓ tasks-kvv P1\n│                ││ boots tk w…           │ │ 📋 · tasks-861t P2   │ │ 📋 👀 tasks-xskm P2   │ │ tk agent CLI\n│                ││ 8m ago · #tern-lua ·  │ │ Events ring buffer + │ │ task→review step 3:   │ │ subcommands\n│                ││ ⛔                    │ │ GET /a…              │ │ mock CL…              │ │ 26d ago\n│                ││                       │ │ 7m ago · #tern-lua   │ │ 8d ago · #task-to-    │ │\n│                ││ 📋 ⛔ tasks-sktb P2   │ │                      │ │ review · 💬1          │ │ 📋 ✓ tasks-11p P1\n│                ││ Luau decode fixture   │ │ 📋 · tasks-wwjc P2   │ │                       │ │ Agent domain schema\n│                ││ tests u…              │ │ HTTP RPC route: POST │ │ 📋 👀 tasks-tnc P2    │ │ and bd …\n│                ││ 8m ago · #tern-lua ·  │ │ api/r…               │ │ task→review step 2:   │ │ 26d ago\n│                ││ ⛔                    │ │ 7m ago · #tern-lua   │ │ mock we…              │ │\n│                ││                       │ │                      │ │ 8d ago · #task-to-    │ │ 📋 ✓ tasks-xml P1\n│                ││ 📋 ⛔ tasks-frux P2   │ │                      │ │ review · 💬1          │ │ Run domain schema an\n│                ││ Luau events.luau:     │ │                      │ │                       │ │ persi…\n│                ││ subscribe…            │ │                      │ │ 📋 👀 tasks-foo P2    │ │ 26d ago\n│                ││ 8m ago · #tern-lua ·  │ │                      │ │ task→review step 1:   │ │\n│                ││ ⛔                    │ │                      │ │ mock TU…              │ │ 📋 ✓ tasks-dwu P1\n│                ││                       │ │                      │ │ 8d ago · #task-to-    │ │ Agent persistence\n│                ││ 📋 ⛔ tasks-wx9v P2   │ │                      │ │ review · 💬1          │ │ across st…\n│yuri            │╰───────────────────────╯ ╰──────────────────────╯ ╰───────────────────────╯ ╰──────────────────────╯\n└────────────────┘  open 51 · wip 6 · rev 9 · blk 21 · done 26                         1-4 views · : commands · ? keys"
    },
    {
      "id": "03",
      "file": "03-task-modal.txt",
      "where": "tui",
      "surface": "Board inline edit modal",
      "mock": "§2 · modal over the board",
      "refs": null,
      "verdict": "match",
      "note": "Modal floats over the board, shows blocked-by deps, artifact preview, edit keybindings; status bar swaps to modal tasks-ti3g · esc close.",
      "spec": "§2 · modal over the board",
      "body": "┌────────────────┐╭─ Open (51) ⛔18 ──────╮ ╭─ In Progress (6) ────╮ ╭─ Review (9) ⛔3 ──────╮ ╭─ Closed (26) ⛔2 ────╮\n│VIEWS           ││  ╭───────────────────────────────────────────────────────────────────────────╮  ✓ tasks-acz P1    ▀\n│  1 ≡ List    92││ B│  tasks-ti3g · 📋 · updated 8m ago                                         │omain: blob-backed\n│▎ 2 ▦ Board   66││ a│   Example Tern plugin tk-board: board block, event refresh, dogfood in    │videnc…\n│  3 ⟐ Graph   28││ 1│  Tern                                                                     │4d ago · #attachmen\n│  4 ◎ Insights  ││ #│                                                                           │\n│  5 ❐ Task      ││  │    ⛔  open    P2    @—                                                   │\n│  6 ▤ Artifacts3││  │    ⛔ blocked by tasks-cs9n                                               │  ✓ tasks-jj6 P1\n│  7 ± Diff     1││ E│                                                                           │2e smoke issue\n│                ││ t│     tern-lua  · 1 deps · 0 comments                                       │6d ago\n│ACTIONS         ││ 8│                                                                           │\n│ n ✎ new        ││  │  ┌─────────────────────────────────────────────────────────────────────┐  │  ✓ tasks-jbf P1\n│ / ⌕ search     ││  │  │  packages/lua/examples/tk-board/: plugin.toml + host.luau using     │  │tatus-driven agent\n│: ≡ commands    ││  │  └─────────────────────────────────────────────────────────────────────┘  │xecuti…\n│ ? ⎇ keys       ││ G│    ↵ title · s/r/o status · +/- prio · a claim · E desc · @ , D X edits   │6d ago\n│                ││ d│  · esc ✕                                                                  │\n│                ││ 8╰───────────────────────────────────────────────────────────────────────────╯  ✓ tasks-pmj P1\n│                ││ ⛔                    │ │ Luau codegen:        │ │ tui deep links:      █│ │ Run lifecycle CLI\n│                ││                       │ │ generator emi…       │ │ grammar + r…         █│ │ 26d ago\n│                ││ 📋 ⛔ tasks-cosq P2   │ │ 7m ago · #tern-lua   │ │ 16h ago · 💬1        █│ │\n│                ││ Integration: bun      │ │                      │ │                       │ │ 📋 ✓ tasks-kvv P1\n│                ││ boots tk w…           │ │ 📋 · tasks-861t P2   │ │ 📋 👀 tasks-xskm P2   │ │ tk agent CLI\n│                ││ 8m ago · #tern-lua ·  │ │ Events ring buffer + │ │ task→review step 3:   │ │ subcommands\n│                ││ ⛔                    │ │ GET /a…              │ │ mock CL…              │ │ 26d ago\n│                ││                       │ │ 7m ago · #tern-lua   │ │ 8d ago · #task-to-    │ │\n│                ││ 📋 ⛔ tasks-sktb P2   │ │                      │ │ review · 💬1          │ │ 📋 ✓ tasks-11p P1\n│                ││ Luau decode fixture   │ │ 📋 · tasks-wwjc P2   │ │                       │ │ Agent domain schema\n│                ││ tests u…              │ │ HTTP RPC route: POST │ │ 📋 👀 tasks-tnc P2    │ │ and bd …\n│                ││ 8m ago · #tern-lua ·  │ │ api/r…               │ │ task→review step 2:   │ │ 26d ago\n│                ││ ⛔                    │ │ 7m ago · #tern-lua   │ │ mock we…              │ │\n│                ││                       │ │                      │ │ 8d ago · #task-to-    │ │ 📋 ✓ tasks-xml P1\n│                ││ 📋 ⛔ tasks-frux P2   │ │                      │ │ review · 💬1          │ │ Run domain schema an\n│                ││ Luau events.luau:     │ │                      │ │                       │ │ persi…\n│                ││ subscribe…            │ │                      │ │ 📋 👀 tasks-foo P2    │ │ 26d ago\n│                ││ 8m ago · #tern-lua ·  │ │                      │ │ task→review step 1:   │ │\n│                ││ ⛔                    │ │                      │ │ mock TU…              │ │ 📋 ✓ tasks-dwu P1\n│                ││                       │ │                      │ │ 8d ago · #task-to-    │ │ Agent persistence\n│                ││ 📋 ⛔ tasks-wx9v P2   │ │                      │ │ review · 💬1          │ │ across st…\n│yuri            │╰───────────────────────╯ ╰──────────────────────╯ ╰───────────────────────╯ ╰──────────────────────╯\n└────────────────┘  open 51 · wip 6 · rev 9 · blk 21 · done 26                            modal tasks-ti3g · esc close"
    },
    {
      "id": "05",
      "file": "05-task-view.txt",
      "where": "tui",
      "surface": "Task view",
      "mock": "§2 · VIEW 1 — fields left, REVIEW rail right, keybindings",
      "refs": "R33 R34 R35 R36 R67 R70",
      "verdict": "match",
      "note": "Left column: id/status/assignee/priority/labels/deps. Right REVIEW rail: branch, base HEAD, diff +6273 −104, files, threads. Footer: v open diff · V diff modal · c comment. Artifacts section absent — tasks-1 has none (conditional per spec).",
      "spec": "§2 · VIEW 1 — fields left, REVIEW rail right, keybindings",
      "body": "┌────────────────┐ id tasks-1                                                               REVIEW\n│VIEWS           │ status open           hello                                              branch —\n│  1 ≡ List    92│ assignee yuri         (no description)                                   base HEAD\n│  2 ▦ Board   66│ priority P2                                                              diff +6273 −104\n│  3 ⟐ Graph   28│ labels —                                                                 FILES 58\n│  4 ◎ Insights  │ deps —                                                                     .agents/plans/2026-10-18-\n│▎ 5 ❐ Task      │                                                                          tui-…\n│  6 ▤ Artifacts3│                                                                            .agents/skills/tasks/\n│  7 ± Diff     1│                                                                          SKILL.md\n│                │                                                                            .gitignore\n│ACTIONS         │                                                                            .planning/.omp-checkpoint\n│ n ✎ new        │                                                                          json\n│ / ⌕ search     │                                                                            .planning/.omp-next-\n│: ≡ commands    │                                                                          action.js…\n│ ? ⎇ keys       │                                                                            .planning/config.json\n│                │                                                                            .planning/milestone.lock\n│                │                                                                            .planning/state.json\n│                │                                                                            .tasks/config.json\n│                │                                                                            CHANGELOG.md\n│                │                                                                            README.md\n│                │                                                                            Taskfile.yml\n│                │                                                                          THREADS 0 open\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│yuri            │                       v open diff · V diff modal · c comment\n└────────────────┘  open 51 · wip 6 · rev 9 · blk 21 · done 26                         1-4 views · : commands · ? keys"
    },
    {
      "id": "06",
      "file": "06-artifact-view.txt",
      "where": "tui",
      "surface": "Artifact view",
      "mock": "§2 · file tree with A/M status, unified hunks, comment footer",
      "refs": "R68 R69",
      "verdict": "match",
      "note": "Tree shows A/M status with per-file +counts, unified @@ hunk gutter, threads rail, comment keybar (c comments · r reply · 7x resolve · esc back to task).",
      "spec": "§2 · file tree with A/M status, unified hunks, comment footer",
      "body": "┌────────────────┐ ⌄ .agents/                                  (no branch) ← HEAD · +6273 −104             no threads —\n│VIEWS           │   ⌄ plans/                                  ▌@@ -0,0 +1,138 @@                        ▀ press c on a\n│  1 ≡ List    92│▌    A 2026-10-18-tui-d…     +138            ▌                                      ▌    hunk to star\n│  2 ▦ Board   66│   ⌄ skills/                                 ▌                                      ▌    one\n│  3 ⟐ Graph   28│     ⌄ tasks/                                ▌                                      ▌\n│  4 ◎ Insights  │       M SKILL.md              +1            ▌                                      ▌\n│  5 ❐ Task      │ M .gitignore                 +17            ▌                                      ▌\n│▎ 6 ▤ Artifacts3│ ⌄ .planning/                                ▌                                      ▌\n│  7 ± Diff     1│   A .omp-checkpoint.js…       +8            ▌                                      ▌\n│                │   A .omp-next-action.j…       +6            ▌                                      ▌\n│ACTIONS         │   M config.json            +7 -3            ▌                                      ▌\n│ n ✎ new        │   A milestone.lock            +6            ▌                                      ▌ 1\n│ / ⌕ search     │   A state.json               +43            ▌                                      ▌ 1\n│: ≡ commands    │ ⌄ .tasks/                                   ▌                                      ▌ 1\n│ ? ⎇ keys       │   M config.json            +4 -1            ▌                                      ▌ 1\n│                │ M CHANGELOG.md               +47            ▌                                      ▌ 1\n│                │ M README.md                +1 -1            ▌                                      ▌ 1\n│                │ A Taskfile.yml                +6            ▌                                      ▌ 1\n│                │ M bun.lock                   +10            ▌                                      ▌ 1\n│                │ ⌄ docs/                                     ▌                                      ▌ 1\n│                │   A .npmrc                    +1            ▌                                      ▌ 1\n│                │   A README.md                +23            ▌                                      ▌ 2\n│                │   A Taskfile.yml             +22            ▌                                      ▌ 2\n│                │   A astro.config.mjs          +7            ▌                                      ▌ 2\n│                │   A bun.lock                +798            ▌                                      ▌ 2\n│                │   A package.json             +14            ▌                                      ▌ 2\n│                │   ⌄ src/                                    ▌                                      ▌ 2\n│                │     A content.config.ts      +12            ▌                                      ▌ 2\n│                │     ⌄ content/                              ▌                                      ▌ 2\n│                │       ⌄ docs/                               ▌                                      ▌ 2\n│                │         A architecture…     +271            ▌                                      ▌ 2\n│                │         A concerns.md       +189            ▌                                      ▌ 3\n│                │         A conventions.…     +122            ▌                                      ▌ 3\n│                │         A integrations…     +104            ▌                                      ▌ 3\n│                │         A overview.md       +488            ▌                                      ▌ 3\n│                │         A rpc.md            +196            ▌                                      ▌ 3\n│                │╭───────────────────────────────────────────────────────────────────────────────────────╮\n│                ││ c comments·rrcreplym· e edit2·7x resolve · esc back to task                           │ [ Comment ]\n│yuri            │╰───────────────────────────────────────────────────────────────────────────────────────╯\n└────────────────┘     ⌄ layouts/                                                      1-4 views · : commands · ? keys"
    },
    {
      "id": "07",
      "file": "07-diff-view.txt",
      "where": "tui",
      "surface": "Diff view — full page",
      "mock": "DIFF · FULL PAGE — tk diff / tk review, hunk keybindings",
      "refs": null,
      "verdict": "match",
      "note": "Full-page diff with mode line (no branch) ← HEAD · +6273 −104; keybar u unified · p split · ] [ file · j k hunk · 7x resolve.",
      "spec": "DIFF · FULL PAGE — tk diff / tk review, hunk keybindings",
      "body": "┌────────────────┐ ⌄ .agents/                                  (no branch) ← HEAD · +6273 −104             no threads —\n│VIEWS           │   ⌄ plans/                                  ▌@@ -0,0 +1,138 @@                        ▀ press c on a\n│  1 ≡ List    92│▌    A 2026-10-18-tui-d…     +138            ▌                                      ▌    hunk to star\n│  2 ▦ Board   66│   ⌄ skills/                                 ▌                                      ▌    one\n│  3 ⟐ Graph   28│     ⌄ tasks/                                ▌                                      ▌\n│  4 ◎ Insights  │       M SKILL.md              +1            ▌                                      ▌\n│  5 ❐ Task      │ M .gitignore                 +17            ▌                                      ▌\n│  6 ▤ Artifacts3│ ⌄ .planning/                                ▌                                      ▌\n│▎ 7 ± Diff     1│   A .omp-checkpoint.js…       +8            ▌                                      ▌\n│                │   A .omp-next-action.j…       +6            ▌                                      ▌\n│ACTIONS         │   M config.json            +7 -3            ▌                                      ▌\n│ n ✎ new        │   A milestone.lock            +6            ▌                                      ▌ 1\n│ / ⌕ search     │   A state.json               +43            ▌                                      ▌ 1\n│: ≡ commands    │ ⌄ .tasks/                                   ▌                                      ▌ 1\n│ ? ⎇ keys       │   M config.json            +4 -1            ▌                                      ▌ 1\n│                │ M CHANGELOG.md               +47            ▌                                      ▌ 1\n│                │ M README.md                +1 -1            ▌                                      ▌ 1\n│                │ A Taskfile.yml                +6            ▌                                      ▌ 1\n│                │ M bun.lock                   +10            ▌                                      ▌ 1\n│                │ ⌄ docs/                                     ▌                                      ▌ 1\n│                │   A .npmrc                    +1            ▌                                      ▌ 1\n│                │   A README.md                +23            ▌                                      ▌ 2\n│                │   A Taskfile.yml             +22            ▌                                      ▌ 2\n│                │   A astro.config.mjs          +7            ▌                                      ▌ 2\n│                │   A bun.lock                +798            ▌                                      ▌ 2\n│                │   A package.json             +14            ▌                                      ▌ 2\n│                │   ⌄ src/                                    ▌                                      ▌ 2\n│                │     A content.config.ts      +12            ▌                                      ▌ 2\n│                │     ⌄ content/                              ▌                                      ▌ 2\n│                │       ⌄ docs/                               ▌                                      ▌ 2\n│                │         A architecture…     +271            ▌                                      ▌ 2\n│                │         A concerns.md       +189            ▌                                      ▌ 3\n│                │         A conventions.…     +122            ▌                                      ▌ 3\n│                │         A integrations…     +104            ▌                                      ▌ 3\n│                │         A overview.md       +488            ▌                                      ▌ 3\n│                │         A rpc.md            +196            ▌                                      ▌ 3\n│                │╭────────────────────────────────────────────────────────────────────────────────────────╮\n│                ││ c comments·rrcreplym· e edit2·7x resolve · u unified · p split · ] [ file · j k hunk · │ [ Comment\n│yuri            │╰────────────────────────────────────────────────────────────────────────────────────────╯\n└────────────────┘     ⌄ layouts/                                                      1-4 views · : commands · ? keys"
    },
    {
      "id": "08",
      "file": "08-tk-show.txt",
      "where": "cli",
      "surface": "tk show — the PR-shaped record",
      "mock": "§1 · tk show TK-142",
      "refs": "R51",
      "verdict": "match",
      "note": "Header line with status pill [● P2 · CLOSED], Type, Created/Updated/Closed, DESCRIPTION, LABELS #task-to-review, COMMENTS with author+date — same shape as the mock.",
      "spec": "§1 · tk show TK-142",
      "body": "✓ tasks-71yd · task→review step 4: packages/git typed adapter + resolveWorktreePath + tk work   [● P2 · CLOSED]\n\nType: task\n\nCreated:     2026-10-11  Updated:     2026-10-19  Closed:      2026-10-19\n\nDESCRIPTION\n  (none)\n\nLABELS: #task-to-review\n\nCOMMENTS (1)\n  2026-10-11 02:10 yuri\n    Step 4 of .agents/plans/2026-10-08-task-to-review.md. Verified by: plan Build order table."
    }
  ],
  "api": {
    "etqk": {
      "id": "tasks-etqk",
      "label": "GET /api/review/tasks-etqk — closed with frozen changeset, worktree since pruned",
      "value": {
        "id": "tasks-etqk",
        "branch": "tk/tasks-etqk",
        "worktree": "/Users/yuri/Workdir/Nsx/tasks-tasks-etqk",
        "base": "97ab249d4b22c3fe41c71935e39f3d439170f2db",
        "head": null,
        "commits": [],
        "files": [],
        "counts": {
          "additions": 0,
          "deletions": 0
        },
        "patch": null,
        "patchError": "changeset derivation failed (missing branch or base?)"
      }
    },
    "t71yd": {
      "id": "tasks-71yd",
      "label": "GET /api/review/tasks-71yd — closed, never branch-pinned, pruned",
      "value": {
        "id": "tasks-71yd",
        "branch": null,
        "worktree": null,
        "base": null,
        "head": null,
        "commits": [],
        "files": [],
        "counts": {
          "additions": 0,
          "deletions": 0
        },
        "patch": null,
        "patchError": null
      }
    }
  },
  "divergences": [
    {
      "n": 1,
      "title": "Changeset source: TUI falls back to the working tree, web is branch-scoped",
      "text": "The TUI task view derives the diff from the working tree when no branch is pinned (tasks-1 renders +6273 −104 against HEAD). The web API instead requires a pinned branch plus changeset.base — unpinned issues return the empty payload with patchError: null. Deliberate: web review is branch-scoped (packages/web/src/review.ts, reviewPayloadFor)."
    },
    {
      "n": 2,
      "title": "Frozen changeset + pruned worktree → graceful patchError",
      "text": "tasks-etqk froze branch tk/tasks-etqk + base at close, and the close path pruned the worktree. GET /api/review/tasks-etqk returns the frozen pointers but patchError: changeset derivation failed (missing branch or base?). The freeze stores branch+base, not the patch text — after prune the patch is not re-derivable, and the API degrades gracefully instead of erroring. Close path also fired the WR-02 unfrozen-snapshot warning."
    },
    {
      "n": 3,
      "title": "Branchless closed issue → clean empty, no error",
      "text": "tasks-71yd (closed, no branch, pruned) returns the all-empty payload with patchError: null — no misleading error for a changeset that never existed."
    }
  ]
};
