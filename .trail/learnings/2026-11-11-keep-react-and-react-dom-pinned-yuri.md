---
title: "Keep react and react-dom pinned to the same exact version in the web package, and rebuild workspace dist before trusting a typecheck failure"
author: Yuri
date: 2026-11-11
branch: main
cost: { minutes: 220, tokens: 1553484 }
id: l-fd72a229
scope: repo
status: active
src: agent
touches:
  - packages/cli/src/tk.ts
  - ".planning/phases/03-review-component-review-storage/03-CONTEXT.md"
  - ".planning/phases/04-terminal-review/04-CONTEXT.md"
  - ".planning/phases/05-web-review/05-CONTEXT.md"
  - tsconfig.json
  - packages/web/package.json
  - packages/surface/package.json
  - docs/html/task-to-review.html
  - docs/html/data/task-to-review-v1-data.js
---

## Decided
The web review island (React, bundled at /assets/review-island.js) must ship react and react-dom at the exact same version. They are pinned to 19.2.8 in the web package.

## Tried and ruled out
Caret ranges (^19.2.0) on both: the lockfile resolved react 19.2.8 next to react-dom 19.3.0 (whose peer wants react ^19.3.0). The bundle then throws "Incompatible React versions" on load, window.ReviewIsland stays undefined, and the Review view renders blank with no server error. curl of the bundle returns 200, so it looks fine from the server side.

## Watch out
- A blank web Review view with a healthy server means the island failed in the browser. Check it with agent-browser eval import("/assets/review-island.js").
- Typecheck errors like "Module @tasks/surface has no exported member X" usually mean a stale gitignored dist/ (package exports point types at dist/index.d.ts). Run bunx tsc -p tsconfig.json in that package before changing source.
- agent-browser shares a default session with other tools. Set AGENT_BROWSER_SESSION=<unique> or another process may navigate your tab away.

In the code:
- packages/web/package.json: "react": "19.2.8", "react-dom": "19.2.8"
- packages/surface/package.json exports: types -> ./dist/index.d.ts (same pattern in domain, git, workspace)
