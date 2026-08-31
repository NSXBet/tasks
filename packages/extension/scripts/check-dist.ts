// Dist sanity: entry + tk-watch must exist and the child must bundle the surface.
import { existsSync, readFileSync } from "node:fs";
const entry = new URL("../dist/index.js", import.meta.url).pathname;
const watch = new URL("../dist/tk-watch.js", import.meta.url).pathname;
if (!existsSync(entry)) { console.error("missing dist/index.js"); process.exit(1); }
if (!existsSync(watch)) { console.error("missing dist/tk-watch.js"); process.exit(1); }
const watchSource = readFileSync(watch, "utf8");
// The child must be self-contained: no runtime import statements pointing at
// workspace packages (bundled path comments are fine).
const importRe = /^\s*(?:import|export)[^;]*from\s+["']@tasks\/surface["']/m;
if (importRe.test(watchSource)) { console.error("tk-watch must bundle @tasks/surface (found import statement)"); process.exit(1); }
const entrySource = readFileSync(entry, "utf8");
if (!/registerTool/.test(entrySource)) { console.error("entry missing extension registration calls"); process.exit(1); }
console.log("dist ok");
