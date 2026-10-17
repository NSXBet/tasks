---
name: print
description: Print/screenshot a web page the way Yuri expects — agent-browser driving a real viewport, authenticated with cookies exported from the running cmux browser. Use EVERY time the task is to "print the page", "screenshot this URL", "show me localhost:PORT/...", "print http://...", capture a UI state, or visually verify a page after a change. Also use when a first screenshot came back as a login/SSO wall, so the retry is authenticated instead of anonymous.
allowed-tools: Bash(agent-browser:*), Bash(cmux:*), Bash(uv:*), Read
---

# Print a page (authenticated, via cmux cookies)

Default engine is **agent-browser**, not cmux, because it gives exact viewports,
`--full` page captures, `snapshot -i` refs and a stable temp screenshot dir. But a fresh
agent-browser profile is anonymous, so any internal app (`localhost:3004/incidents/*`,
staging, anything behind corporate SSO) renders a **login wall** — a useless screenshot.

Fix: cmux already holds the logged-in session. Export its state, convert it to Playwright
shape, load it into agent-browser. Do this **before** the first capture, not after a
wasted anonymous attempt.

## Fast path (copy-paste)

```bash
# 0. repo-local tmp (never litter the repo root)
mkdir -p .agents/tmp

# 1. open the target in cmux so the surface carries the live session, note the surface id
cmux browser open "http://localhost:3004/incidents/presenter?tab=highlights"
# -> OK surface=surface:731 pane=pane:121 placement=reuse

# 2. export cmux browser state (cookies + localStorage). ABSOLUTE PATH REQUIRED.
cmux browser --surface surface:731 state save "$PWD/.agents/tmp/cmux-auth.json"

# 3. convert CDP-shaped dump -> Playwright state agent-browser can load
# (uv/PEP-723 script, self-executing, stdlib only)
~/.agents/skills/print/scripts/cmux-state-to-playwright.py \
  .agents/tmp/cmux-auth.json .agents/tmp/auth-clean.json

# 4. print
agent-browser batch --bail \
  "set viewport 1600 1200" \
  "state load $PWD/.agents/tmp/auth-clean.json" \
  "open http://localhost:3004/incidents/presenter?tab=highlights" \
  "wait 3000" \
  "screenshot $PWD/.agents/tmp/page-top.png"
```

Then `read` the PNG path to actually look at it. A capture you did not read is not a print.

State is reusable — skip steps 1-3 while `.agents/tmp/auth-clean.json` is still valid and
jump straight to step 4.

## Hard requirements

- **Absolute paths everywhere.** `cmux browser state save` with a relative path fails
  (`internal_error: Failed to write state file`). `agent-browser screenshot` with a
  relative path silently resolves against the *daemon's* cwd, not yours — the file is not
  where you asked and `read` then fails. Always `$PWD/.agents/tmp/...`. `--screenshot-dir`
  is likewise unreliable for this; pass the full output path instead.
- **Never `agent-browser state load` the raw cmux dump.** It errors with
  `Invalid state file: invalid type: null, expected f64` — cmux writes `expires: null`
  for session cookies and `session_only` / `http_only` key names. The converter script is
  the one supported translation; do not hand-edit dumps inline or re-invent the mapping.
- **Filter to the target host.** A real cmux profile holds thousands of cookies
  (`www.amazon.co.jp`, ad trackers…). The script keeps only host-matching ones. For a
  non-default host: `--host mycorp.example --origin https://app.mycorp.example`.
- **Tmp files go to `.agents/tmp/`** inside the current repo, never repo root, never
  `/tmp/`. The state file holds live session tokens — treat it as a secret, keep
  `.agents/tmp/` gitignored, delete when done.

## Choosing viewport and capture mode

```bash
agent-browser set viewport 1600 1200                  # desktop default; readable text
agent-browser set viewport 1600 1200 2                # 2x DPI, same layout, crisper output
agent-browser set viewport 375 812                    # mobile check
agent-browser screenshot "$PWD/out.png"               # viewport only — USE THIS BY DEFAULT
agent-browser screenshot --full "$PWD/out.png"        # whole page
agent-browser screenshot --annotate                   # numbered refs, for clicking next
```

`--full` on a long list page produces something like 1600x35124, which downscales to an
unreadable ribbon and burns vision tokens. For long pages capture **viewport slices**:

```bash
agent-browser batch --bail \
  "screenshot $PWD/.agents/tmp/hl-1.png" \
  "scroll down 1100" "screenshot $PWD/.agents/tmp/hl-2.png" \
  "scroll down 1100" "screenshot $PWD/.agents/tmp/hl-3.png"
```

## SPA timing

`open` waits for `load`, which is not enough for an RTK-Query/SPA screen that fetches after
mount. Prefer a signal over a sleep:

```bash
agent-browser wait --text "Highlights"
agent-browser wait "#content"
agent-browser wait --fn "!document.body.innerText.includes('Loading')"
agent-browser wait 3000                     # acceptable fallback
```

Never `wait --load networkidle` — analytics/websocket traffic hangs it.

## When cmux is not available

Fallbacks, in order:
1. `agent-browser --auto-connect state save ./auth.json` — pull from user's running Chrome.
2. `agent-browser --profile Default open <url>` — reuse a Chrome profile directly.
3. `cmux browser --surface <id> screenshot --out <path>` — cmux prints natively (already
   authenticated) but gives no viewport control or `--full`; fine for a quick look.

## Report back

State what the screenshot shows, not that you took one: page/route, key visible state
(filters, counts, selected tab), and any defect you can see (unrendered markdown, layout
break, error banner). Give the saved path.
