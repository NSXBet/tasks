/**
 * Watch child process for the tasks extension.
 * Spawned by the extension (or run standalone) with:
 *   bun tk-watch.js <root> [--kinds a,b] [--ids x,y] [--label l] [--interval ms]
 * Emits NDJSON frames on stdout; exits 0 on stdin EOF, 2 without a workspace,
 * 3 after three consecutive backend errors.
 */
import { openSurfaceStore, parseWatchArgs, rootFrom, runWatchChild } from "@tasks/surface";

const root = await rootFrom(process.argv[2] ?? process.cwd());
if (root === null) {
  process.stderr.write("no tasks workspace found\n");
  process.exit(2);
}
const store = await openSurfaceStore(root, {});
const subscription = parseWatchArgs(process.argv.slice(3));
await runWatchChild(store, subscription);
