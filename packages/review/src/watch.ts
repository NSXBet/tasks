/**
 * Watch entry for hosts that keep a review session live (the TUI).
 *
 * Git-free and OpenTUI-free: it re-exports the vendored debounced watch
 * controller and the chokidar-backed event source. Callers build the
 * `WatchPlan` (which directories and ref files to observe) and the signature
 * function (typically a hash of the tk-derived patch from `gitDiffPatch` in
 * @tasks/git); this entry never spawns git itself (D-04). Do not import
 * `./index`, `./opentui/index`, `./app/*` or @tasks/surface from here.
 */
export { createWatchController } from "./core/watch/controller";
export type { WatchController, WatchControllerOptions } from "./core/watch/controller";
export { createWatchEventSource } from "./core/watch/observer";
export type { WatchPlan, WatchTarget } from "./core/watch/plan";
