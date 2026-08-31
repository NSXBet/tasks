import { rootFrom } from '../discover.js';
import { openSurfaceStore } from '../store.js';
import { runWatchChild } from './core.js';
import { parseWatchArgs } from './protocol.js';

/** Child-process entry: `bun tk-watch.js <root> [--kinds a,b] [--ids x,y] [--label l] [--interval ms]` */
const root = await rootFrom(process.argv[2] ?? process.cwd());
if (root === null) {
  process.stderr.write('no tasks workspace found\n');
  process.exit(2);
}
const store = await openSurfaceStore(root, {});
const subscription = parseWatchArgs(process.argv.slice(3));
await runWatchChild(store, subscription);
