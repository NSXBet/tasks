/**
 * Headless entry for non-interactive consumers (smoke tests, node hosts).
 *
 * Git-free, OpenTUI-free and store-free: callers pass a tk-derived unified
 * patch (from `gitDiffPatch` in @tasks/git) and get the review diff model
 * back. The review component never spawns git itself (D-04). Do not import
 * `./index`, `./opentui/index`, `./app/*` or @tasks/surface from here.
 */
export { changesetFromPatch } from "./core/changeset/fromPatch";
export { countHunkDiffStats, createHunkDiffFilesFromPatch } from "./opentui/model";
export type { Changeset, DiffFile } from "./core/changeset/model";
export type { HunkDiffFile, HunkDiffStats } from "./opentui/types";
