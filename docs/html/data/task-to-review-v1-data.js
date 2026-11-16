window.DATA = window.DATA || {};
window.DATA.taskAsPrV1 = {
  "meta": {
    "date": "2026-11-12",
    "repo": "NSXBet/tasks",
    "commit": "main @ 3925234 · milestone v1 complete",
    "workspace": "scratch repo · 4 issues · 2 open · 0 wip · 1 review · 1 done · 1 blocked",
    "tui": "bun packages/tui/src/main.tsx + tk review <id> · tmux 160×40",
    "web": "bun packages/web/src/main.ts --port 52872",
    "cli": "bun packages/cli/src/tk.ts",
    "prints": "tmux capture-pane -p (ANSI stripped) · scratch repo /tmp/claude-ttr-v1-20261112/repo",
    "screenshots": "web-task-demo-ntg.png · web-diff-demo-rw3-closed.png (agent-browser, 1440×900)",
    "script": "tasks: demo-ntg (2 commits, evidence, 2 comments, finished s1) · demo-rw3 (finished, merged, closed → pruned) · demo-qs8 (tk work + 1 commit) · demo-znh (never worked, blocked by demo-ntg)"
  },
  "prints": [
    {
      "id": "01",
      "file": "01-list.txt",
      "where": "tui · list",
      "surface": "Views rail + list view",
      "spec": "§2 · rail tabs with counts; list rows status/priority/id/title/age",
      "refs": "R47 R51",
      "verdict": "match",
      "note": "7 views with live counts, status filter tabs, 💬 counts per row; the doors line (tk review <id> · web URL) follows the selected row (R51). New views are additive — List/Board/Graph/Insights untouched (R47).",
      "body": "┌────────────────┐ all  ready  open  wip  review  closed  mine  sprint  icebox\n│VIEWS           │👀 P1 ready… demo-ntg Fix flaky retry logic… 49s 💬2\n│▎ 1 ≡ List     4│⚡ P2 open demo-qs8 Add upload progress e… 1m\n│  2 ▦ Board    3│✓ P2 closed demo-rw3 Document uploader ret… 44s 💬1\n│  3 ⟐ Graph    1│⛔ P3 open demo-znh Cache resolved upload… 1m\n│  4 ◎ Insights  │\n│  5 ❐ Task      │\n│  6 ▤ Artifacts3│\n│  7 ± Diff     1│\n│                │\n│ACTIONS         │\n│ n ✎ new        │\n│ / ⌕ search     │\n│: ≡ commands    │\n│ ? ⎇ keys       │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│yuri            │review tk review demo-ntg · http://localhost:52872/tasks/demo-ntg\n└────────────────┘  open 2 · wip 0 · rev 1 · blk 1 · done 1                                                                     1-4 views · : commands · ? keys"
    },
    {
      "id": "02",
      "file": "02-board.txt",
      "where": "tui · board",
      "surface": "Board — 4-column kanban",
      "spec": "§2 · Open / In Progress / Review / Closed",
      "refs": null,
      "verdict": "match",
      "note": "Columns and ⛔ blocked chip render from the record. demo-qs8 sits in Open, not In Progress, after tk work — see §4 gap R18.",
      "body": "┌────────────────┐╭─ Open (2) ⛔1 ──────────────────╮ ╭─ In Progress (0) ───────────────╮ ╭─ Review (1) ───────────────────╮ ╭─ Closed (1) ────────────────────╮\n│VIEWS           ││ 📋 ⚡ demo-qs8 P2               │ │                                 │ │ 📋 👀 demo-ntg P1              │ │ 📋 ✓ demo-rw3 P2                │\n│  1 ≡ List     4││ Add upload progress events      │ │                                 │ │ Fix flaky retry logic in up…   │ │ Document uploader retry pol…    │\n│▎ 2 ▦ Board    3││ 1m ago · #uploader              │ │                                 │ │ 1m ago · #uploader · 💬2       │ │ 54s ago · 💬1                   │\n│  3 ⟐ Graph    1││                                 │ │                                 │ │                                │ │                                 │\n│  4 ◎ Insights  ││ 📋 ⛔ demo-znh P3               │ │                                 │ │                                │ │                                 │\n│  5 ❐ Task      ││ Cache resolved upload URLs      │ │                                 │ │                                │ │                                 │\n│  6 ▤ Artifacts3││ 1m ago · ⛔                     │ │                                 │ │                                │ │                                 │\n│  7 ± Diff     1││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│ACTIONS         ││                                 │ │                                 │ │                                │ │                                 │\n│ n ✎ new        ││                                 │ │                                 │ │                                │ │                                 │\n│ / ⌕ search     ││                                 │ │                                 │ │                                │ │                                 │\n│: ≡ commands    ││                                 │ │                                 │ │                                │ │                                 │\n│ ? ⎇ keys       ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                ││                                 │ │                                 │ │                                │ │                                 │\n│                │╰─────────────────────────────────╯ ╰─────────────────────────────────╯ ╰────────────────────────────────╯ ╰─────────────────────────────────╯\n│yuri            │review tk review demo-qs8 · http://localhost:52872/tasks/demo-qs8\n└────────────────┘  open 2 · wip 0 · rev 1 · blk 1 · done 1                                                                     1-4 views · : commands · ? keys"
    },
    {
      "id": "03",
      "file": "03-task-view.txt",
      "where": "tui · task view, CHANGES tab",
      "surface": "Task view — TASKS column + tabbed rail",
      "spec": "VIEW 1 · TASK VIEW — description front and center, artifacts in the main column, sessions in the side rail",
      "refs": "R33 R34 R35 R36 R64 R67 R69 R70 R73",
      "verdict": "match",
      "note": "TASKS column left of the task (R34); worktree + branch→base chips (R70); ◧ open diff is the primary action, no start-work on ready-to-review (R69); ARTIFACTS = tk evidence (R64); COMMENTS carry their location (R73). Rail tabs SESSIONS │ CHANGES │ WORKSPC │ MINIMAP — CHANGES reads the worktree live, including the untracked NOTES.md [A] (R61, R67).",
      "body": "┌────────────────┐                       │                                                                            │ SESSIONS │ CHANGES │ WORKSPC │ MINIMAP\n│VIEWS           │TASKS                  │ Fix flaky retry logic in uploader                                          │ ───────────━━━━━━━────────────────────\n│  1 ≡ List     4│▎● Fix flaky retry lo… │ demo-ntg · ready-to-review · @unassigned · P1                              │\n│  2 ▦ Board    3│ ● Add upload progres… │ [ worktree /private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo…  │ ▸ src/                                ●\n│  3 ⟐ Graph    1│ ● Cache resolved upl… │ [ tk/demo-ntg → 9cc1016 ]                                                  │   uploader.ts [M]                     ●\n│  4 ◎ Insights  │                       │                                                                            │ ▸ test/                               ●\n│▎ 5 ❐ Task      │                       │ ◧ v open diff · V diff modal · c comment                                   │   uploader.test.ts [A]                ●\n│  6 ▤ Artifacts3│                       │                                                                            │ NOTES.md [A]                          ●\n│  7 ± Diff     1│                       │ (no description)                                                           │ ↵ diff modal · tab next\n│                │                       │                                                                            │ live from the worktree ●\n│ACTIONS         │                       │ ARTIFACTS — evidence on the task                                           │\n│ n ✎ new        │                       │ 0 src · 0 edit · 0 new · 1 other                                           │\n│ / ⌕ search     │                       │ UNREFERENCED (1)                                                           │\n│: ≡ commands    │                       │ ▸ test-run.log                                                     —       │\n│ ? ⎇ keys       │                       │ J/K select · o open                                                        │\n│                │                       │                                                                            │\n│                │                       │ COMMENTS · 2   comments 2 · 2 open 0 ✓                                     │\n│                │                       │ yuri: 4xx should not be retried — good; add a test… → src/uploader.ts:15   │\n│                │                       │ yuri: Cap the backoff at ~5s so the 5th attempt doe… → src/uploader.ts:5   │\n│                │                       │                                                                            │\n│                │                       │ review  TUI tk review demo-ntg                                             │\n│                │                       │         web http://localhost:52872/tasks/demo-ntg                          │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│yuri            │[ ] switch task        │                                                                            │\n└────────────────┘  open 2 · wip 0 · rev 1 · blk 1 · done 1                                                                     1-4 views · : commands · ? keys"
    },
    {
      "id": "03b",
      "file": "03b-task-sessions.txt",
      "where": "tui · task view, SESSIONS tab",
      "surface": "Sessions — in the rail, never leading",
      "spec": "VIEW 3 · SESSION VIEW — the agent's rationale above the change",
      "refs": "R22 R67 R68",
      "verdict": "match",
      "note": "Sessions are the SESSIONS tab of the rail (omp · session s1, DONE), recorded by tk finish --session s1. The main column stays the work (R68). No separate session view ships in v1 — the rail is the delivered form.",
      "body": "┌────────────────┐                       │                                                                            │ SESSIONS │ CHANGES │ WORKSPC │ MINIMAP\n│VIEWS           │TASKS                  │ Fix flaky retry logic in uploader                                          │ ━━━━━━━━──────────────────────────────\n│  1 ≡ List     4│▎● Fix flaky retry lo… │ demo-ntg · ready-to-review · @unassigned · P1                              │\n│  2 ▦ Board    3│ ● Add upload progres… │ [ worktree /private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo…  │ AGENT RUNS ON THE TASK\n│  3 ⟐ Graph    1│ ● Cache resolved upl… │ [ tk/demo-ntg → 9cc1016 ]                                                  │ STATUS  SESSION                     UPD\n│  4 ◎ Insights  │                       │                                                                            │ DONE    omp · session s1             4m\n│▎ 5 ❐ Task      │                       │ ◧ v open diff · V diff modal · c comment                                   │ sessions live in the rail — the center…\n│  6 ▤ Artifacts3│                       │                                                                            │\n│  7 ± Diff     1│                       │ (no description)                                                           │\n│                │                       │                                                                            │\n│ACTIONS         │                       │ ARTIFACTS — evidence on the task                                           │\n│ n ✎ new        │                       │ 0 src · 0 edit · 0 new · 1 other                                           │\n│ / ⌕ search     │                       │ UNREFERENCED (1)                                                           │\n│: ≡ commands    │                       │   test-run.log                                                     —       │\n│ ? ⎇ keys       │                       │ J/K select · o open                                                        │\n│                │                       │                                                                            │\n│                │                       │ COMMENTS · 2   comments 2 · 2 open 0 ✓                                     │\n│                │                       │ yuri: 4xx should not be retried — good; add a test… → src/uploader.ts:15   │\n│                │                       │ yuri: Cap the backoff at ~5s so the 5th attempt doe… → src/uploader.ts:5   │\n│                │                       │                                                                            │\n│                │                       │ review  TUI tk review demo-ntg                                             │\n│                │                       │         web http://localhost:21579/tasks/demo-ntg                          │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│yuri            │[ ] switch task        │                                                                            │\n└────────────────┘  open 2 · wip 0 · rev 1 · blk 1 · done 1                                                                     1-4 views · : commands · ? keys"
    },
    {
      "id": "04",
      "file": "04-diff-full.txt",
      "where": "tui · diff, full page",
      "surface": "Diff view — full page (hunk)",
      "spec": "DIFF · FULL PAGE — hunk's keybar, watch mode",
      "refs": "R26 R46 R72 R74",
      "verdict": "match",
      "note": "Mode line tk/demo-ntg ← 9cc1016e973f · +30 −4 (live: the untracked NOTES.md is counted). hunk's own keys: ]/[ hunk · ./, file · 1/2 layout · s l z / v y a t ?; watching worktree ● indicator; EVIDENCE pane lists test-run.log as a comment target (R74); comments pane with S send to agent. Only r refresh is absent — see §4·1.",
      "body": "┌────────────────┐ ⌄ src/                            tk/demo-ntg ← 9cc1016e973f · +30 −4                                     COMMENTS · 2 open · 0 ✓\n│VIEWS           │▌  M uploader.ts           +19 -4  ▌@@ -1,7 +1,22 @@                                                       S send 2 to agent\n│  1 ≡ List     4│ ⌄ test/                           ▌    1 +  const MAX_ATTEMPTS = 5;                                       ▸ open src/uploader.ts:15\n│  2 ▦ Board    3│   A uploader.test.ts         +10  ▌    2 +  const BASE_DELAY_MS = 200;                                       yuri: 4xx should not be retrie…\n│  3 ⟐ Graph    1│ A NOTES.md                    +1  ▌    3 +                                                                  open src/uploader.ts:5\n│  4 ◎ Insights  │                                   ▌    4 +  function backoff(attempt: number): number {                      yuri: Cap the backoff at ~5s s…\n│  5 ❐ Task      │EVIDENCE · 1                       ▌    5 +    const jitter = Math.random() * BASE_DELAY_MS;\n│  6 ▤ Artifacts3│ ▣ test-run.log · 💬 0             ▌    6 +    return BASE_DELAY_MS * 2 ** attempt + jitter;\n│▎ 7 ± Diff     1│                                   ▌    7 +  }\n│                │                                   ▌    8 +\n│ACTIONS         │                                   ▌ 1  9    export async function upload(file: Blob, url: string) {\n│ n ✎ new        │                                   ▌   10 +    let lastError: unknown;\n│ / ⌕ search     │                                   ▌   11 +    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {\n│: ≡ commands    │                                   ▌ 2    -    for (let attempt = 0; attempt < 3; attempt++) {\n│ ? ⎇ keys       │                                   ▌ 3    -      const res = await fetch(url, { method: \"PUT\", body: file\n│                │                                   ▌ 4    -      if (res.ok) return res;\n│                │                                   ▌   12 +      try {\n│                │                                   ▌   13 +        const res = await fetch(url, { method: \"PUT\", body: fil\n│                │                                   ▌   14 +        if (res.ok) return res;\n│                │                                   ▌   15 +        if (res.status < 500) throw new Error(`upload rejected:\n│                │                                   ▌   16 +      } catch (err) {\n│                │                                   ▌   17 +        lastError = err;\n│                │                                   ▌   18 +      }\n│                │                                   ▌   19 +      await new Promise((r) => setTimeout(r, backoff(attempt)))\n│                │                                   ▌ 5 20      }\n│                │                                   ▌ 6    -    throw new Error(\"upload failed\");\n│                │                                   ▌   21 +    throw new Error(\"upload failed\", { cause: lastError });\n│                │                                   ▌ 7 22    }\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │ watching worktree — re-derives as commits land ●\n│                │ q quit  c note  ]/[ hunk  ./, file  1/2 layout  s files  l line numbers  z context  / search  v select  y copy  a notes  t theme  ? help\n│yuri            │ R reply  E edit note  e edit hunk  x ✓ done · D ✕ remove · S send to agent  J/K note  o open as file  esc back\n└────────────────┘  open 2 · wip 0 · rev 1 · blk 1 · done 1                                                                     1-4 views · : commands · ? keys"
    },
    {
      "id": "05",
      "file": "05-diff-modal.txt",
      "where": "tui · task view → V",
      "surface": "Diff modal over the task view",
      "spec": "DIFF · MODAL — esc closes, ⤢ expands to the full diff view",
      "refs": "R45 R71",
      "verdict": "match",
      "note": "Modal floats over the task view on src/uploader.ts [M] +19 −4; f ⤢ full view · esc close; comments under the hunk with c line / C file. Its footer still names j/k for hunks (an alias) while the full page names ]/[.",
      "body": "┌────────────────┐                       │                                                                            │ SESSIONS │ CHANGES │ WORKSPC │ MINIMAP\n│VIEWS           │TASKS                  │ Fix flaky retry logic in uploader                                          │ ───────────━━━━━━━────────────────────\n│  1 ≡ List  ╭────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮\n│  2 ▦ Board │ demo-ntg / src/uploader.ts [M] +19 −4                                                                    f ⤢ full view · esc close │           ●\n│  3 ⟐ Graph │ ▌@@ -1,7 +1,22 @@                                                                                                                █ │           ●\n│  4 ◎ Insigh│ ▌    1 +  const MAX_ATTEMPTS = 5;                                                                                                █ │           ●\n│▎ 5 ❐ Task  │ ▌    2 +  const BASE_DELAY_MS = 200;                                                                                             █ │           ●\n│  6 ▤ Artifa│ ▌    3 +                                                                                                                         █ │           ●\n│  7 ± Diff  │ ▌    4 +  function backoff(attempt: number): number {                                                                            █ │\n│            │ ▌    5 +    const jitter = Math.random() * BASE_DELAY_MS;                                                                        █ │\n│ACTIONS     │ ▌    6 +    return BASE_DELAY_MS * 2 ** attempt + jitter;                                                                        █ │\n│ n ✎ new    │ ▌    7 +  }                                                                                                                      █ │\n│ / ⌕ search │ ▌    8 +                                                                                                                         █ │\n│: ≡ commands│ ▌ 1  9    export async function upload(file: Blob, url: string) {                                                                █ │\n│ ? ⎇ keys   │ ▌   10 +    let lastError: unknown;                                                                                              █ │\n│            │ ▌   11 +    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {                                                           █ │\n│            │ ▌ 2    -    for (let attempt = 0; attempt < 3; attempt++) {                                                                      █ │\n│            │ ▌ 3    -      const res = await fetch(url, { method: \"PUT\", body: file });                                                       ▀ │\n│            │ ▌ 4    -      if (res.ok) return res;                                                                                              │\n│            │ ▌   12 +      try {                                                                                                                │\n│            │ ▌   13 +        const res = await fetch(url, { method: \"PUT\", body: file });                                                       │\n│            │ ▌   14 +        if (res.ok) return res;                                                                                            │\n│            │ ▌   15 +        if (res.status < 500) throw new Error(`upload rejected: ${res.status}`);                                           │\n│            │ ▌   16 +      } catch (err) {                                                                                                      │\n│            │ ▌   17 +        lastError = err;                                                                                                   │\n│            │ ▌   18 +      }                                                                                                                    │\n│            │ ▌   19 +      await new Promise((r) => setTimeout(r, backoff(attempt)));                                                           │\n│            │ ▌ 5 20      }                                                                                                                      │\n│            │ COMMENTS · 2 open · 0 ✓                                                                                                            │\n│            │ S send 2 to agent                                                                                                                  │\n│            │ ▸ open src/uploader.ts:15                                                                                                          │\n│            │    yuri: 4xx should not be retried — good; add a test for the 404 path too.                                                        │\n│            │   open src/uploader.ts:5                                                                                                           │\n│            │    yuri: Cap the backoff at ~5s so the 5th attempt does not wait 3.2s+.                                                            │\n│            │ c comment on a line · C comment on the file · j/k hunk · esc close · f ⤢ full view — file · line · evidence                        │\n│            ╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯\n│                │                       │                                                                            │\n│                │                       │                                                                            │\n│yuri            │[ ] switch task        │                                                                            │\n└────────────────┘  open 2 · wip 0 · rev 1 · blk 1 · done 1                                                                     1-4 views · : commands · ? keys"
    },
    {
      "id": "06",
      "file": "06-artifact-view.txt",
      "where": "tui · 6 Artifacts",
      "surface": "Artifact view — file, commentable",
      "spec": "VIEW 2 · ARTIFACT VIEW — every file, commentable, line-by-line or entire file",
      "refs": "R37 R38 R41 R43",
      "verdict": "match",
      "note": "A file view, separate from the diff (fixed since 2026-10-19, when artifact view = diff view). Line gutter with comments inline under lines 5 and 15; comments rail on the right; c comment on the line · C comment on the file.",
      "body": "┌────────────────┐ demo-ntg / src/uploader.ts                                                                                                2 OPEN · 0 ✓  CODE\n│VIEWS           │\n│  1 ≡ List     4│  1 │ const MAX_ATTEMPTS = 5;                                                                    │ COMMENTS · 2 OPEN · 0 ✓\n│  2 ▦ Board    3│  2 │ const BASE_DELAY_MS = 200;                                                                 │\n│  3 ⟐ Graph    1│  3 │                                                                                            │ open src/uploader.ts:5\n│  4 ◎ Insights  │  4 │ function backoff(attempt: number): number {                                                │   yuri: Cap the backoff at ~5s so the 5th…\n│  5 ❐ Task      │  5 │   const jitter = Math.random() * BASE_DELAY_MS;                                            │\n│▎ 6 ▤ Artifacts3│       ▸ yuri: Cap the backoff at ~5s so the 5th attempt does not wait 3.2s+. · open             │ open src/uploader.ts:15\n│  7 ± Diff     1│  6 │   return BASE_DELAY_MS * 2 ** attempt + jitter;                                            │   yuri: 4xx should not be retried — good;…\n│                │  7 │ }                                                                                          │\n│ACTIONS         │  8 │                                                                                            │\n│ n ✎ new        │  9 │ export async function upload(file: Blob, url: string) {                                    │\n│ / ⌕ search     │ 10 │   let lastError: unknown;                                                                  │\n│: ≡ commands    │ 11 │   for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {                               │\n│ ? ⎇ keys       │ 12 │     try {                                                                                  │\n│                │ 13 │       const res = await fetch(url, { method: \"PUT\", body: file });                         │\n│                │ 14 │       if (res.ok) return res;                                                              │\n│                │ 15 │       if (res.status < 500) throw new Error(`upload rejected: ${res.status}`);             │\n│                │       ▸ yuri: 4xx should not be retried — good; add a test for the 404 path too. · open         │\n│                │ 16 │     } catch (err) {                                                                        │\n│                │ 17 │       lastError = err;                                                                     │\n│                │ 18 │     }                                                                                      │\n│                │ 19 │     await new Promise((r) => setTimeout(r, backoff(attempt)));                             │\n│                │ 20 │   }                                                                                        │\n│                │ 21 │   throw new Error(\"upload failed\", { cause: lastError });                                  │\n│                │ 22 │ }                                                                                          │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│                │                                                                                                 │\n│yuri            │ j/k line  g/G first/last  c comment on the line  C comment on the file  esc back to task  ? help\n└────────────────┘  open 2 · wip 0 · rev 1 · blk 1 · done 1                                                                     1-4 views · : commands · ? keys"
    },
    {
      "id": "07",
      "file": "07-closed-review.txt",
      "where": "tk review demo-rw3 (closed, worktree + branch pruned)",
      "surface": "Closed task — review from the frozen snapshot",
      "spec": "§7 verify 8 · closed task renders commits + diff with no worktree or branch",
      "refs": "R61",
      "verdict": "match",
      "note": "tk close merged-and-pruned tk/demo-rw3 and its worktree. tk review still renders base…head from the changeset frozen at close, with the resolved comment. It still shows the watching worktree ● line, which is wrong for a pruned task (§4 finding).",
      "body": "┌────────────────┐\n│VIEWS           │ ▌M README.md                   +3  tk/demo-rw3 ← 9cc1016e973f · +3 −0                                     COMMENTS · All resolved\n│  1 ≡ List     4│                                    ▌@@ -1,2 +1,5 @@                                                       ▸ ✓ resolved README.md:4\n│  2 ▦ Board    3│                                    ▌1 1    # demo                                                            yuri: Mention the 4xx no-retry…\n│  3 ⟐ Graph    1│                                    ▌2 2    Uploader demo repo.\n│  4 ◎ Insights  │                                    ▌  3 +\n│  5 ❐ Task      │                                    ▌  4 +  ## Retry policy\n│  6 ▤ Artifacts3│                                    ▌  5 +  Uploads retry 5xx up to 5 times with exponential backoff and\n│▎ 7 ± Diff     1│\n│                │\n│ACTIONS         │\n│ n ✎ new        │\n│ / ⌕ search     │\n│: ≡ commands    │\n│ ? ⎇ keys       │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │ watching worktree — re-derives as commits land ●\n│                │ q quit  c note  ]/[ hunk  ./, file  1/2 layout  s files  l line numbers  z context  / search  v select  y copy  a notes  t theme  ? help\n│yuri            │ R reply  E edit note  e edit hunk  x ✓ done · D ✕ remove · S send to agent  J/K note  o open as file  esc back\n└────────────────┘  open 2 · wip 0 · rev 1 · blk 1 · done 1                                                                     1-4 views · : commands · ? keys"
    },
    {
      "id": "08",
      "file": "08-branchless.txt",
      "where": "tk review demo-znh (never worked)",
      "surface": "Branchless task — no diff, a pointer",
      "spec": "§12 · changes read from the task's worktree, never the workspace",
      "refs": "R61",
      "verdict": "match",
      "note": "Before (2026-10-19) the TUI fell back to the workspace working tree (+6273 −104 on tasks-1). Now: no branch yet — run tk work demo-znh. Same as the web payload in §3.",
      "body": "┌────────────────┐\n│VIEWS           │ no branch yet — run tk work demo-znh\n│  1 ≡ List     4│   tk work demo-znh\n│  2 ▦ Board    3│ q quit  c note  ]/[ hunk  ./, file  1/2 layout  s files  l line numbers  z context  / search  v select  y copy  a notes  t theme  ? help\n│  3 ⟐ Graph    1│ R reply  E edit note  e edit hunk  x ✓ done · D ✕ remove · S send to agent  J/K note  o open as file  esc back\n│  4 ◎ Insights  │\n│  5 ❐ Task      │\n│  6 ▤ Artifacts3│\n│▎ 7 ± Diff     1│\n│                │\n│ACTIONS         │\n│ n ✎ new        │\n│ / ⌕ search     │\n│: ≡ commands    │\n│ ? ⎇ keys       │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│                │\n│yuri            │\n└────────────────┘  open 2 · wip 0 · rev 1 · blk 1 · done 1                                                                     1-4 views · : commands · ? keys"
    },
    {
      "id": "09",
      "file": "09-tk-show.txt",
      "where": "cli",
      "surface": "tk show — the PR-shaped record",
      "spec": "§1 · tk show TK-142",
      "refs": "R16 R17 R50 R51",
      "verdict": "match",
      "note": "Status pill, agent line (omp · session s1 finished), review doors (TUI + web), REVIEW block with ○ open comments and their file:line, BRANCH/BASE/WORKTREE, derived COMMITS and FILES, EVIDENCES.",
      "body": "$ tk show demo-ntg\n🔍 demo-ntg · Fix flaky retry logic in uploader   [● P1 · READY-TO-REVIEW]\n\nType: task\n\nCreated:     2026-11-12  Updated:     2026-11-12\n\nagent omp · session s1 finished 2026-11-12 22:27\nreview tk review demo-ntg · http://localhost:52872/tasks/demo-ntg\ncomments 2 · 2 open 0 ✓\n\nREVIEW (2) · 2 open · 0 ✓\n  ○ src/uploader.ts:15  yuri  4xx should not be retried — good; add a test for the 404 path too.\n  ○ src/uploader.ts:5  yuri  Cap the backoff at ~5s so the 5th attempt does not wait 3.2s+.\n\nDESCRIPTION\n  (none)\n\nLABELS: #uploader\n\nNOTES\n  backoff in; 5xx retry test green\n\nBRANCH: tk/demo-ntg\nBASE:        9cc1016e973f013674114432b149a4f425166d01\nWORKTREE:    /private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo-ntg\n\nCOMMITS (2)\n  47c127f test(uploader): cover 5xx retry path\n  cdab501 fix(uploader): exponential backoff with jitter\n\nFILES (2)\n  M src/uploader.ts\n  A test/uploader.test.ts\n\nATTACHMENTS: (none)\nEVIDENCES (1)\n  test-run.log (ev-c5e7cd, 0.1 kB)\n\nCOMMENTS (2)\n  2026-11-12 22:27 yuri\n    [review src/uploader.ts:15] 4xx should not be retried — good; add a test for the 404 path too.\n\n  2026-11-12 22:27 yuri\n    [review src/uploader.ts:5] Cap the backoff at ~5s so the 5th attempt does not wait 3.2s+."
    },
    {
      "id": "10",
      "file": "10-tk-show-closed.txt",
      "where": "cli",
      "surface": "tk show — closed, after prune",
      "spec": "§1 · the record outlives the worktree",
      "refs": "R61",
      "verdict": "match",
      "note": "Commits and files still derive from the frozen snapshot after the worktree and branch are gone; close reason under NOTES; REVIEW · All resolved.",
      "body": "$ tk show demo-rw3\n✓ demo-rw3 · Document uploader retry policy   [● P2 · CLOSED]\n\nType: task\n\nCreated:     2026-11-12  Updated:     2026-11-12  Closed:      2026-11-12\n\nagent omp · session s1 finished 2026-11-12 22:27\nreview tk review demo-rw3 · http://localhost:52872/tasks/demo-rw3\ncomments 1 · All resolved · 1 ✓\n\nREVIEW (1) · All resolved\n  ✓ README.md:4  yuri  Mention the 4xx no-retry rule.\n\nDESCRIPTION\n  (none)\n\nNOTES\n  approved: retry policy documented in README.md\n\nBRANCH: tk/demo-rw3\nBASE:        9cc1016e973f013674114432b149a4f425166d01\nWORKTREE:    /private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo-rw3\n\nCOMMITS (1)\n  1453878 docs: uploader retry policy\n\nFILES (1)\n  M README.md\n\nCOMMENTS (1)\n  2026-11-12 22:27 yuri\n    [review README.md:4] Mention the 4xx no-retry rule."
    },
    {
      "id": "11",
      "file": "11-tk-changes.txt",
      "where": "cli",
      "surface": "tk changes — the stat card",
      "spec": "§12 · chat carries a stat card that links to the changes view",
      "refs": "R60",
      "verdict": "match",
      "note": "One line per task: commits · +− · files → web changes view · tk review. The link points to the live web port. Works on the closed task too.",
      "body": "$ tk changes demo-ntg\nChanges · demo-ntg  2 commits · +29 −4 · 2 files  → http://localhost:52872/tasks/demo-ntg/diff · tk review demo-ntg\n\n$ tk changes demo-rw3\nChanges · demo-rw3  1 commit · +3 −0 · 1 file  → http://localhost:52872/tasks/demo-rw3/diff · tk review demo-rw3"
    },
    {
      "id": "12",
      "file": "12-tk-comments.txt",
      "where": "cli",
      "surface": "tk comments — status + location",
      "spec": "§3 · comments with status, one store, location tags",
      "refs": "R62 R63 R73",
      "verdict": "match",
      "note": "Each comment carries its id, status (○ open / ✓ resolved), file:line, author. Same store as TUI and web: the comments below were posted via the web API and render in every TUI print above.",
      "body": "$ tk comments demo-ntg\nREVIEW (2) · 2 open · 0 ✓\n  t-mwe4cfzh-mx64ur ○ src/uploader.ts:15  yuri  4xx should not be retried — good; add a test for the 404 path too.\n  t-mwe4cg08-t29g6b ○ src/uploader.ts:5  yuri  Cap the backoff at ~5s so the 5th attempt does not wait 3.2s+."
    },
    {
      "id": "13",
      "file": "13-tk-watch-drain.txt",
      "where": "cli",
      "surface": "tk watch --drain — the event log",
      "spec": "§10 · the wire: one append-only events log, per-subscriber cursors",
      "refs": "R56 R57 R58",
      "verdict": "match",
      "note": "Every step of this session as typed events: task.created → task.worktree → task.evidence → task.status open → ready-to-review → task.report → task.comment → closed + metadata.worktreePruned.",
      "body": "$ tk watch --drain\n#1 22:27:00 demo-ntg task.created Fix flaky retry logic in uploader\n#2 22:27:00 demo-qs8 task.created Add upload progress events\n#3 22:27:01 demo-rw3 task.created Document uploader retry policy\n#4 22:27:01 demo-znh task.created Cache resolved upload URLs\n#5 22:27:01 demo-ntg task.update labels\n#6 22:27:01 demo-qs8 task.update labels\n#7 22:27:01 demo-znh task.update dependencies\n#8 22:27:02 demo-ntg task.worktree tk/demo-ntg /private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo-ntg\n#9 22:27:02 demo-ntg task.update metadata.changeset\n#10 22:27:20 demo-ntg task.evidence test-run.log\n#11 22:27:20 demo-ntg task.update notes\n#12 22:27:21 demo-ntg task.status open → ready-to-review\n#13 22:27:21 demo-ntg task.report 2 commits +29 −4 2 files\n#14 22:27:22 demo-rw3 task.worktree tk/demo-rw3 /private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo-rw3\n#15 22:27:22 demo-rw3 task.update metadata.changeset\n#16 22:27:23 demo-rw3 task.status open → ready-to-review\n#17 22:27:23 demo-rw3 task.report 1 commits +3 −0 1 files\n#18 22:27:23 demo-qs8 task.worktree tk/demo-qs8 /private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo-qs8\n#19 22:27:23 demo-qs8 task.update metadata.changeset\n#20 22:27:50 demo-ntg task.comment yuri: 4xx should not be retried — good; add a test for the 404 path too.\n#21 22:27:50 demo-ntg task.comment yuri: Cap the backoff at ~5s so the 5th attempt does not wait 3.2s+.\n#22 22:27:50 demo-rw3 task.comment yuri: Mention the 4xx no-retry rule.\n#23 22:27:55 demo-rw3 task.comment yuri: Mention the 4xx no-retry rule.\n#24 22:27:55 demo-rw3 task.status ready-to-review → closed\n#25 22:27:55 demo-rw3 task.update metadata.changeset,metadata.worktreePruned,notes"
    }
  ],
  "matrixExtra": [
    {
      "n": "W1",
      "surface": "Web task view /tasks/:id",
      "spec": "VIEW 1 (web) — same task view, same record",
      "refs": "R42 R67 R69",
      "link": "data/v1/web-task-demo-ntg.png",
      "linkText": "web-task-demo-ntg.png",
      "verdict": "match",
      "note": "TASKS column, worktree + branch chips, open diff primary, ARTIFACTS, COMMENTS with locations, rail SESSIONS/CHANGES/WORKSPC/MINIMAP with NOTES.md live."
    },
    {
      "n": "W2",
      "surface": "Web diff island — closed + pruned",
      "spec": "DIFF · FULL VIEW (WEB) — every file, line + file comments",
      "refs": "R72 R73 R74",
      "link": "data/v1/web-diff-demo-rw3-closed.png",
      "linkText": "web-diff-demo-rw3-closed.png",
      "verdict": "match",
      "note": "split diff from the frozen snapshot, RESOLVED thread on line 4 with reopen/reply, + comment on file. The 2026-10-19 DIVERGES row (patchError on prune) is resolved."
    }
  ],
  "shots": [
    {
      "src": "data/v1/web-task-demo-ntg.png",
      "label": "/tasks/demo-ntg — web task view, live worktree (1440×900)"
    },
    {
      "src": "data/v1/web-diff-demo-rw3-closed.png",
      "label": "/tasks/demo-rw3/diff — closed + pruned, rendered from the frozen snapshot"
    }
  ],
  "api": [
    {
      "id": "GET /api/review/demo-ntg",
      "label": "Live, ready-to-review — worktree present. files/counts come from the commits (2 files, +29 −4); patch is the live worktree diff and also carries the untracked NOTES.md (§4 finding).",
      "value": {
        "id": "demo-ntg",
        "branch": "tk/demo-ntg",
        "worktree": "/private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo-ntg",
        "base": "9cc1016e973f013674114432b149a4f425166d01",
        "head": "47c127fab35368adebbdb886a617192c8163b464",
        "commits": [
          {
            "sha": "47c127f",
            "subject": "test(uploader): cover 5xx retry path"
          },
          {
            "sha": "cdab501",
            "subject": "fix(uploader): exponential backoff with jitter"
          }
        ],
        "files": [
          {
            "path": "src/uploader.ts",
            "status": "M"
          },
          {
            "path": "test/uploader.test.ts",
            "status": "A"
          }
        ],
        "counts": {
          "additions": 29,
          "deletions": 4
        },
        "patch": "diff --git a/src/uploader.ts b/src/uploader.ts\nindex 5824a8cc1a8b355b554c4f66713e2b6a65427702..7332924fea326f43b164b72e5c5dec0ced103319 100644\n--- a/src/uploader.ts\n+++ b/src/uploader.ts\n@@ -1,7 +1,22 @@\n+const MAX_ATTEMPTS = 5;\n+const BASE_DELAY_MS = 200;\n+\n+function backoff(attempt: number): number {\n+  const jitter = Math.random() * BASE_DELAY_MS;\n+  return BASE_DELAY_MS * 2 ** attempt + jitter;\n+}\n+\n export async function upload(file: Blob, url: string) {\n-  for (let attempt = 0; attempt < 3; attempt++) {\n-    const res = await fetch(url, { method: \"PUT\", body: file });\n-    if (res.ok) return res;\n+  let lastError: unknown;\n+  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {\n+    try {\n+      const res = await fetch(url, { method: \"PUT\", body: file });\n+      if (res.ok) return res;\n+      if (res.status < 500) throw new Error(`upload rejected: ${res.status}`);\n+    } catch (err) {\n+      lastError = err;\n+    }\n+    await new Promise((r) => setTimeout(r, backoff(attempt)));\n   }\n-  throw new Error(\"upload failed\");\n+  throw new Error(\"upload failed\", { cause: lastError });\n }\ndiff --git a/test/uploader.test.ts b/test/uploader.test.ts\nnew file mode 100644\nindex 0000000000000000000000000000000000000000..7cca4f538b9a280377d1d92bf5c072ae97654aad\n--- /dev/null\n+++ b/test/uploader.test.ts\n@@ -0,0 +1,10 @@\n+import { expect, test } from \"bun:test\";\n+import { upload } from \"../src/uploader\";\n+\n+test(\"retries 5xx then succeeds\", async () => {\n+  let calls = 0;\n+  globalThis.fetch = (async () => new Response(null, { status: ++calls < 3 ? 503 : 200 })) as typeof fetch;\n+  const res = await upload(new Blob([\"x\"]), \"https://example.test/u\");\n+  expect(res.status).toBe(200);\n+  expect(calls).toBe(3);\n+});\ndiff --git a/NOTES.md b/NOTES.md\nnew file mode 100644\nindex 0000000000000000000000000000000000000000..401ecdef02c57ddf68be73a902b6585946344d01\n--- /dev/null\n+++ b/NOTES.md\n@@ -0,0 +1 @@\n+untracked notes",
        "patchError": null,
        "evidence": [
          {
            "id": "ev-c5e7cd",
            "name": "test-run.log",
            "mime": "application/octet-stream"
          }
        ]
      }
    },
    {
      "id": "GET /api/review/demo-rw3",
      "label": "Closed — merged, branch deleted, worktree pruned. Renders from the frozen snapshot: head + commits + patch, patchError null. On 2026-10-19 this case returned patchError.",
      "value": {
        "id": "demo-rw3",
        "branch": "tk/demo-rw3",
        "worktree": "/private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo-rw3",
        "base": "9cc1016e973f013674114432b149a4f425166d01",
        "head": "14538787840dc3aa29093718605cf011910710cf",
        "commits": [
          {
            "sha": "1453878",
            "subject": "docs: uploader retry policy"
          }
        ],
        "files": [
          {
            "path": "README.md",
            "status": "M"
          }
        ],
        "counts": {
          "additions": 3,
          "deletions": 0
        },
        "patch": "diff --git a/README.md b/README.md\nindex 931cce77219e558d7f5c3768c34949fdbfa7ce98..ad9ec2ec59f9f23d1fbb5964d87bdc00c81ab511 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,2 +1,5 @@\n # demo\n Uploader demo repo.\n+\n+## Retry policy\n+Uploads retry 5xx up to 5 times with exponential backoff and jitter.",
        "patchError": null,
        "evidence": []
      }
    },
    {
      "id": "GET /api/review/demo-znh",
      "label": "Never worked — no branch. Empty payload, patchError null.",
      "value": {
        "id": "demo-znh",
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
        "patchError": null,
        "evidence": []
      }
    },
    {
      "id": "GET /api/review/demo-ntg/taskview (stats + minimap trimmed)",
      "label": "The task page's one payload: CHANGES tree (live, NOTES.md included), evidence-backed artifacts, sessions, workspace chips, located comments.",
      "value": {
        "changes": [
          {
            "kind": "dir",
            "depth": 0,
            "name": "src/",
            "path": "src",
            "status": null,
            "needsReview": true
          },
          {
            "kind": "file",
            "depth": 1,
            "name": "uploader.ts",
            "path": "src/uploader.ts",
            "status": "M",
            "needsReview": true
          },
          {
            "kind": "dir",
            "depth": 0,
            "name": "test/",
            "path": "test",
            "status": null,
            "needsReview": true
          },
          {
            "kind": "file",
            "depth": 1,
            "name": "uploader.test.ts",
            "path": "test/uploader.test.ts",
            "status": "A",
            "needsReview": true
          },
          {
            "kind": "file",
            "depth": 0,
            "name": "NOTES.md",
            "path": "NOTES.md",
            "status": "A",
            "needsReview": true
          }
        ],
        "artifacts": {
          "counts": {
            "src": 0,
            "edit": 0,
            "new": 0,
            "other": 1
          },
          "groups": [
            {
              "label": "UNREFERENCED",
              "rows": [
                {
                  "key": "evidence:ev-c5e7cd",
                  "kind": "evidence",
                  "name": "test-run.log",
                  "path": null,
                  "evidenceId": "ev-c5e7cd",
                  "mime": "application/octet-stream",
                  "status": null,
                  "comments": 0
                }
              ]
            }
          ]
        },
        "sessions": [
          {
            "id": "session:s1",
            "state": "done",
            "label": "omp · session s1",
            "updatedAt": "2026-11-12T22:27:21.458Z"
          }
        ],
        "workspace": {
          "branch": "tk/demo-ntg",
          "base": "9cc1016e973f013674114432b149a4f425166d01",
          "worktree": "/private/tmp/claude-ttr-v1-20261112/repo/.worktrees/repo-demo-ntg",
          "worktreeLabel": ".worktrees/repo-demo-ntg",
          "host": "192.168.0.247",
          "dirty": 1,
          "pr": null
        },
        "comments": {
          "counts": {
            "total": 2,
            "open": 2,
            "sent": 0,
            "resolved": 0,
            "dismissed": 0,
            "unresolved": 2,
            "label": "2 open · 0 ✓"
          },
          "rows": [
            {
              "id": "t-mwe4cfzh-mx64ur",
              "author": "yuri",
              "first": "4xx should not be retried — good; add a test for the 404 path too.",
              "location": "src/uploader.ts:15",
              "filePath": "src/uploader.ts",
              "status": "open"
            },
            {
              "id": "t-mwe4cg08-t29g6b",
              "author": "yuri",
              "first": "Cap the backoff at ~5s so the 5th attempt does not wait 3.2s+.",
              "location": "src/uploader.ts:5",
              "filePath": "src/uploader.ts",
              "status": "open"
            }
          ]
        }
      }
    }
  ],
  "divergences": [
    {
      "n": 1,
      "kind": "deliberate",
      "title": "No r refresh key — the diff re-renders live",
      "text": "The spec keybar has r refresh. The live diff drops it: a watch controller re-derives the changeset as commits land and shows watching worktree ● (prints 04, 07). Accepted deviation, recorded in .trail/learnings (spec-is-the-contract)."
    },
    {
      "n": 2,
      "kind": "deliberate",
      "title": "z / v / y act on the whole diff and whole hunks",
      "text": "hunk's z context, v select and y copy keep their keys, but in tk they act on the whole diff and on whole hunks, not on a line range. Accepted deviation, recorded with no. 1."
    },
    {
      "n": 3,
      "kind": "deliberate",
      "title": "PR record narrowed to {number, url, state}",
      "text": "metadata.pr is the local mirror of the task's one PR: {number, url, state ∈ open|closed|merged} (packages/domain/src/pr-record.ts). Only the explicit tk pr verbs refresh it, and nothing polls. The spec's richer PR card fields are not stored (Phase 11 D-01)."
    },
    {
      "n": 4,
      "kind": "deferred",
      "title": "tk next oracle — deferred to v2",
      "text": "R54/R55: the script, evidence, nudges (next: tk pr create <id> after finish) and pickup ship. The tk next oracle that answers \"what now\" is deferred to v2 (.planning/PROJECT.md)."
    },
    {
      "n": 5,
      "kind": "deliberate",
      "title": "The title does not seed the branch name — branches are tk/<id>",
      "text": "R06: tk work always creates tk/<id> (tk/demo-ntg, tk/demo-rw3) and a .worktrees/<repo>-<id> worktree. This is a decision (GIT-03), but the AGENTS.md loop table still says \"the title seeds the branch name\"."
    }
  ],
  "gaps": [
    {
      "n": "G1",
      "kind": "gap",
      "title": "tk work does not claim or move the task to in-progress (R18, tasks-jlhs)",
      "text": "Observed live: after tk work demo-qs8 the task stays open and unassigned (board: In Progress (0); status bar wip 0). The contract table says tk work claims. Tracked as tasks-jlhs."
    },
    {
      "n": "G2",
      "kind": "finding",
      "title": "Frozen-snapshot review still shows \"watching worktree ●\"",
      "text": "Print 07: for a closed task with its worktree and branch pruned, startReviewWatch (packages/tui/src/review/live.ts) still starts a watcher. The source has a branch and a base, so the watcher runs against the main checkout. The line implies a live worktree that no longer exists. The render itself is correct. Found during this capture."
    },
    {
      "n": "G3",
      "kind": "finding",
      "title": "/api/review files/counts are commit-derived; patch is live",
      "text": "demo-ntg returns files (2) and counts +29 −4 from the commits, but its patch includes the untracked NOTES.md. The taskview, TUI rail and TUI diff (+30 −4) count it. Small inconsistency inside one payload. Found during this capture."
    }
  ],
  "resolved": [
    {
      "was": "2026-10-19 div. 1",
      "title": "TUI working-tree fallback for branchless tasks — removed",
      "text": "Branchless tasks now show \"no branch yet — run tk work <id>\" (print 08). The web returns the empty payload. Both surfaces are branch-scoped."
    },
    {
      "was": "2026-10-19 div. 2",
      "title": "Frozen changeset + pruned worktree → patchError — fixed",
      "text": "Web (§3 demo-rw3) and TUI (print 07) both render base…head from the snapshot frozen at close. The TUI half closed the v1 audit's last blocker (2026-11-12)."
    },
    {
      "was": "2026-10-19 div. 3",
      "title": "Branchless closed issue → clean empty",
      "text": "Still true and now the designed behavior, not a divergence (§3 demo-znh)."
    },
    {
      "was": "2026-10-19 matrix row 8",
      "title": "Web diff island DIVERGES — resolved",
      "text": "The island renders the frozen snapshot with threads, resolve/reopen and reply (matrix W2)."
    },
    {
      "was": "2026-10-19 prints 05–07",
      "title": "Artifact view = diff view, REVIEW rail untabbed — replaced",
      "text": "The task view now has the TASKS column and the tabbed rail (03, 03b). The artifact view is a file viewer (06). The diff is hunk's full page (04) plus a modal (05)."
    }
  ]
};
