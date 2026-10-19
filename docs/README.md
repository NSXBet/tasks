# docs

Documentation site for **tk**, built with [Astro](https://astro.build). Layout
mirrors pilgrimagegame.com/docs: one continuous scroll of all documents, an
outline rail with section jump links, and full-text search.

## Commands

```sh
bun install   # first time
bun run dev   # dev server
bun run build # static build (runs Pagefind indexing)
bun run run   # serve the built site (search needs this)
```

## How it works

- Pages live in `src/content/docs/*.md` — edit them directly.
- `src/pages/index.astro` renders every collection entry on one page; the
  rail outline is derived from each entry's headings.
- Search is [Pagefind](https://pagefind.app) via `astro-pagefind` — the index
  is built during `astro build`, so full-text search works under
  `bun run run` (static hosting) but shows a placeholder in `dev`.
