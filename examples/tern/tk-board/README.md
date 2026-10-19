# tk Board — Tern plugin

A Tern block listing this workspace's tk issues (open/in-progress/blocked, priority-sorted),
auto-refreshed from the tk event poll.

## Layout

- `plugin.toml` — manifest: one palette block, `board`.
- `host.luau` — `tern.block.define("board", …)`; discovery → fetch → event-driven refresh.
- `lib/tk/` — vendored copies of the tk Luau client (`packages/lua/luau/tk/`).
  Tern's `require` cannot reach outside the package directory, so the library is copied in.
- `sync.sh` — re-copies `lib/tk/` after any change to the library.

## Usage

```sh
tk web &                 # host this workspace (registers .tasks/runtime.json)
./sync.sh                # refresh vendored lib after library changes
tern plugin link examples/tern/tk-board
tern plugin reload
```

Then run the `New tk Board` palette command inside a workspace served by `tk web`.
Keys: `r` refetches immediately.

## Vendoring

The five library files must stay in sync with `packages/lua/luau/tk/`. `sync.sh`
copies them verbatim; run it, then `tern plugin reload`.
