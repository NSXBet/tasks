#!/bin/sh
# Syncs the vendored tk Luau client (lib/tk) from packages/lua/luau/tk.
# Run after any change to the library; the plugin requires its own copies
# because Tern's `require` cannot reach outside the package directory.
set -eu
cd "$(dirname "$0")"
for f in json transport wire client events; do
	cp -f "../../../packages/lua/luau/tk/$f.luau" "lib/tk/$f.luau"
done
echo "synced lib/tk from packages/lua/luau/tk"
