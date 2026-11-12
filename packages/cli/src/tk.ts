#!/usr/bin/env bun
import { access, copyFile, cp, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { fstatSync } from "node:fs";
import { cwd, exit, stdin } from "node:process";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { findBeadsWorkspace, inferPrefix, migrateBeadsJsonl, resolveBeadsJsonl, searchPath, type MigrationSummary } from "@tasks/beads";
import { AgentAccessSchema, AgentModeSchema, AgentSchema, RunSchema, RunStateSchema, agentId, agentName, agentSlug, dependencyTarget, isBlobAttachment, issueDescription, issueFromBdWire, issueId, issuePriority, issueTitle, issueToBdWire, runId, reviewDoors, readReportStat, readPrRecord, detectHarness, SprintSchema, type PrRecord, sprintSlug, sprintToBdWire, type Agent, type AgentAccess, type AgentMode, type Issue, type IssueAttachment, type IssueId, type IssuePathAttachment, type Metadata, type Run, type Sprint } from "@tasks/domain";
import { applyRunSideEffects, canonicalTimestampCodec, err, isActiveRunState, nextRunId, ok, type IssueUnitOfWork, type Result } from "@tasks/application";
import { DEFAULT_STORAGE, describeStorage, openEphemeralScratch, openStorage, readWorkspaceConfig, resolveStorageConfig, writeWorkspaceConfig, type StorageAdapter, type StorageConfig, type WorkspaceConfig } from "@tasks/workspace";
import { booleanFlag, directory, parseArgs, stringFlag, ArgumentParseError, type ParsedArgs } from "./args.js";
import { gitBranchExists, gitCommonDir, gitCreateBranch, gitCurrentBranch, gitDefaultBranch, gitDeleteBranch, ensureWorktreePoolIgnored, gitHasUncommittedChanges, gitHasUnpushedCommits, gitMergeBase, gitStashCount, gitWorktreeAdd, gitWorktreeList, gitWorktreeRemove, mainWorktreeRoot, resolveWorktreePath, runShellHook, runPackageManagerSetup, pruneClosedWorktree, gitIsMergedToBase } from "@tasks/git";
import {
  confirmation, formatBackup, formatBlocked, formatCount, formatDepList, formatDoctor,
  formatDuplicates, formatEpic, formatGraph, formatHistory, formatLint, formatList, formatMigration, formatOrphans,
  formatAgentList, formatAgentShow, formatInbox, formatReady, formatRenamePrefix, formatRunList, formatRunShow, formatRuntimeActivity, formatRuntimeList, formatSearch, formatShow, formatSprintList, formatStale, formatStats,
  formatStatus, formatStatuses, formatTodo, formatTree, formatTypes, formatVersion, formatWhere, formatWorktreeInfo, formatWorktreeList,
  formatLeaseList, formatFinish, formatChanges, formatPr, formatReviewComments, formatReviewSend, formatReviewStatus,
  HUMAN_HELP, INIT_HELP, LINT_SECTIONS, PRIME, QUICKSTART, SWITCH_BACKEND_HELP, VERSION, cyan, dim, duration, formatError, formatMarkdown, green, issueWire, output, treeNodeWire,
} from "./presentation.js";
import { withEventLog, resolveChanges, changesWire, prCreate, prSync, prShow, prClose, prMerge, PR_MERGE_METHODS, attachEvidenceUow, attachPathUow, detachBlobUow, deriveChangeset, pruneIssueWorktree, evidenceReadUow, finishIssueUow, freezeChangesetUow, readChangesetBase, readChangesetSnapshot, reviewComments, reviewCommentListUow, reviewCommentSendUow, reviewCommentSetStatusUow, inboxEntries, markInboxArchived, markInboxRead, openSurfaceStore, probeWebServer, readActivity, readInboxMarkers, readRuntimeRegistry, resolveWebBase, resolveWebPort, unregisterRuntime, WEB_DEFAULT_PORT, type ActivityRow, type BlobContent, type InboxEntry, type RuntimeRow, acquirePolling, clampTtl, LeaseBusyError, LeaseStateError, readLeases, releaseLeaseFile, renewLeaseFile, waitDeadline, getOrThrow, type LeaseRequest, type LeaseRow } from "@tasks/surface";
import { cleanStaleSocket, connectDaemon, connectOrSpawn, daemonSocketPath, probeDaemon, RpcCallError, socketAlive, type DaemonStatus } from "@tasks/daemon";
import { buildTree, type TreeOptions } from "./tree.js";
import { checkGitHooks, installHooks, managedHookNames, runHookCommand, uninstallHooks } from "./hooks.js";
import { CODEX_EVENTS, installCodexHooks, codexHooksPath, installCursorHooks, cursorHooksTargetPath, removeCodexHooks, removeCursorHooks } from "./hooks-json.js";
import { runCodexHook, runCursorHook } from "./agent-hooks.js";
import { runSelfUpdate, UPDATER_HELP } from "./update.js";
import { runSkill } from "./skill.js";
import { runOnboard } from "./onboard.js";

/** bd-style collision-resistant issue IDs: <prefix>-<base36 hash>, short like bd (bd-0t0, bd-45g). */
const generateId = (): string => randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");
/** Start at 3 chars (like bd), grow on collision pressure. */
const idLength = (taken: number): number => (taken < 50 ? 3 : taken < 1_000 ? 4 : 6);

const writers = new Set(["init", "create", "q", "update", "close", "reopen", "defer", "undefer", "comment", "note", "assign", "priority", "tag", "dep", "label", "set-state", "import", "migrate", "delete", "remove", "rename", "link", "duplicate", "supersede", "todo", "backup", "rename-prefix", "switch-backend", "hooks", "attach", "detach", "sprint", "agent", "run", "archive", "unarchive", "work", "finish", "lease", "pr"]);
type JsonError = { readonly error: { readonly kind: "parse" | "validation" | "readonly" | "conflict" | "not_found" | "runtime"; readonly message: string } };
type Config = WorkspaceConfig;
const fail: (message: string) => never = (message) => { throw new Error(message); };
/** Lease identity for holds created by this process: `--holder` wins, then
 * agent-session envs, so `tk status`/busy messages name the responsible session. */
const leaseHolder = (args: ParsedArgs): string => stringFlag(args, "holder") ?? process.env["TK_SESSION"] ?? process.env["OMP_SESSION_ID"] ?? "unknown";
const leaseWire = (lease: LeaseRow): Record<string, unknown> => ({ schema_version: 1, _type: "lease", name: lease.name, holder: lease.holder, purpose: lease.purpose, issue_id: lease.issue, granted_at: lease.grantedAt, expires_at: lease.expiresAt, remaining_ms: Math.max(0, new Date(lease.expiresAt).getTime() - Date.now()) });
/** Parses `--ttl`/`--wait` millisecond flags; rejects non-numeric values loudly. */
const parseMsFlag = (args: ParsedArgs, name: "ttl" | "wait"): number | undefined => {
  const raw = stringFlag(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) fail(`invalid --${name}: expected milliseconds`);
  return value;
};
/** `--ttl`/`--wait` through the surface's bounded-range validation; this
 * repo's `fail()` doesn't participate in control-flow narrowing, so the
 * helpers return the number instead of guarding at each call site. */
const leaseTtl = (args: ParsedArgs): number => { const clamped = clampTtl(parseMsFlag(args, "ttl")); return typeof clamped === "number" ? clamped : fail(clamped.message); };
const leaseWait = (args: ParsedArgs): number => { const deadline = waitDeadline(parseMsFlag(args, "wait")); return typeof deadline === "number" ? deadline : fail(deadline.message); };
const errorWire = (_key: string, value: unknown): unknown => value instanceof Error ? { name: value.name, message: value.message } : value;
const unwrap = <T, E>(result: Result<T, E>): T => { if (result.ok) return result.value; const error = result.error; const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : JSON.stringify(error, errorWire); return fail(message); };
/** Bun.stdin reads both pipes and file redirects; async-iterating `stdin` misses redirects. */
const readInput = async (): Promise<string> => (await Bun.stdin.text()).trimEnd();
/**
 * WR-02: a close that ends with a changeset base record but no frozen
 * snapshot means CHG-02 freeze derivation failed at close time (exactly-once
 * went unmet for that branch). Non-fatal; warns once per closed issue.
 */
const warnUnfrozenChangeset = (issue: Issue): void => {
  if (issue.status !== "closed" || readChangesetBase(issue.metadata) === null || readChangesetSnapshot(issue.metadata) !== null) return;
  process.stderr.write(`tk: warning: ${issue.id} closed with a changeset base record but no frozen snapshot (freeze derivation failed at close)\n`);
};
const timeFrom = (value: unknown, fallback: Date): Date => { const parsed = new Date(String(value)); return Number.isNaN(parsed.valueOf()) ? fallback : parsed; };
const parseDate = (value: string | undefined): Date | null | undefined => { if (value === undefined) return undefined; if (value === "" || value === "null") return null; const date = new Date(value); if (Number.isNaN(date.valueOf())) fail(`invalid date: ${value}`); return date; };
const parseMetadata = (value: string | undefined): Metadata | undefined => { if (value === undefined) return undefined; const parsed: unknown = JSON.parse(value); if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") fail("metadata must be JSON object"); return parsed as Metadata; };
const metadataEntry = (value: string): readonly [string, Metadata[string]] => { const separator = value.indexOf("="); if (separator <= 0) fail("metadata entry must be key=value"); const key = value.slice(0, separator); const raw = value.slice(separator + 1); try { return [key, JSON.parse(raw) as Metadata[string]]; } catch { return [key, raw]; } };
/**
 * `--attach <path>[=json]` (repeatable) → attachment records. Bare paths are
 * stored workspace-root-relative (`foo.yaml` means `<repo>/foo.yaml`, the way
 * agents reference repo files). Inline `=json` or a trailing
 * `--attach-metadata key=value,...` carries per-attachment metadata.
 */
/** Parses raw `path[={json}]` entries into path attachments; trailing `--attach-metadata` applies to the last entry. */
/** Web base URL for review doors: the registered web runtime when present, else the default port. No probing. */
const webBase = (root: string): Promise<string> => resolveWebBase(join(root, ".tasks"));

const parseAttachmentEntries = (entries: readonly (readonly [string, string | undefined])[], root: string, trailing: string | undefined): IssuePathAttachment[] =>
  entries.map(([entryPath, inlineMeta], index) => {
    let metadata: Metadata = {};
    if (inlineMeta !== undefined) { try { const parsed: unknown = JSON.parse(inlineMeta); if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Metadata; else metadata = { value: parsed as Metadata[string] }; } catch { metadata = { value: inlineMeta }; } }
    if (trailing !== undefined && index === entries.length - 1) { const trailingMeta: Metadata = {}; for (const part of trailing.split(",").filter(Boolean)) { const [key, value] = metadataEntry(part); trailingMeta[key] = value; } metadata = { ...metadata, ...trailingMeta }; }
    return { path: isAbsolute(entryPath) ? entryPath : relative(root, resolve(root, entryPath)), metadata, wireUnknown: {} };
  });
const parseAttachments = (args: ParsedArgs, root: string): IssuePathAttachment[] => {
  const raw = args.flags.get("attach") as string | readonly string[] | undefined;
  const plan = stringFlag(args, "plan");
  if (raw === undefined && plan === undefined) return [];
  const strings = (Array.isArray(raw) ? raw : [raw]).filter((entry): entry is string => typeof entry === "string" && entry !== "");
  const entries = parseAttachmentEntries(strings.map((entry) => { const separator = entry.indexOf("="); return separator > 0 ? [entry.slice(0, separator), entry.slice(separator + 1)] as const : [entry, undefined] as const; }), root, stringFlag(args, "attach-metadata"));
  return entries.concat(plan === undefined ? [] : [{ path: isAbsolute(plan) ? plan : relative(root, resolve(root, plan)), metadata: { kind: "plan" }, wireUnknown: {} }]);
};
/**
 * Resolves `--status <s>` or its boolean shorthands (`--open`, `--closed`,
 * `--all`, `--ready-to-review`, `--approved`, `--rejected`) to a status value,
 * the `"all"` sentinel, or undefined. Shorthands and `--status` are mutually
 * exclusive; conflicting shorthands fail rather than silently winning.
 */
const statusFilter = (args: ParsedArgs): string | undefined => {
  const shorthands = (["open", "closed", "ready-to-review", "approved", "rejected", "all"] as const).filter((name) => booleanFlag(args, name));
  const explicit = stringFlag(args, "status");
  if (explicit !== undefined && shorthands.length > 0) fail(`--status cannot be combined with --${shorthands[0]}`);
  if (shorthands.length > 1) fail(`--${shorthands[0]} and --${shorthands[1]} are mutually exclusive`);
  return explicit ?? shorthands[0];
};
/** Statuses the CLI treats as first-class lifecycle values, in workflow order. */
const KNOWN_STATUSES: readonly string[] = ["open", "in_progress", "ready-to-review", "approved", "rejected", "closed", "archived"];
/**
 * `tk init --backend/--filename/--url-env` only ever produce a `StorageConfig`
 * written into `.tasks/config.json` — no other command reads these flags, and
 * this value is never consulted again after `init` returns.
 */
/**
 * Builds a `StorageConfig` from a backend name plus its location-specific extras, shared by
 * `tk init --backend ...` and `tk switch-backend <backend> ...` — the only two places a backend
 * name is ever accepted as CLI input.
 */
const storageConfigFromParts = (backend: string, filename: string | undefined, urlEnv: string | undefined): StorageConfig => {
  if (backend === "file") {
    if (filename !== undefined) fail("--filename requires the sqlite backend");
    if (urlEnv !== undefined) fail("--url-env requires the postgres backend");
    return { backend: "file" };
  }
  if (backend === "sqlite") {
    if (urlEnv !== undefined) fail("--url-env requires the postgres backend");
    return filename === undefined ? { backend: "sqlite" } : { backend: "sqlite", filename };
  }
  if (backend === "postgres") {
    if (filename !== undefined) fail("--filename requires the sqlite backend");
    return urlEnv === undefined ? { backend: "postgres" } : { backend: "postgres", urlEnv };
  }
  return fail(`invalid backend: ${backend} (expected file, sqlite, or postgres)`);
};
const initStorageConfig = (args: ParsedArgs): StorageConfig => {
  const backend = stringFlag(args, "backend");
  const filename = stringFlag(args, "filename");
  const urlEnv = stringFlag(args, "url-env");
  if (backend === undefined) {
    if (filename !== undefined) fail("--filename requires --backend sqlite");
    if (urlEnv !== undefined) fail("--url-env requires --backend postgres");
    return DEFAULT_STORAGE;
  }
  return storageConfigFromParts(backend, filename, urlEnv);
};
/** `tk switch-backend <target>` always names its target explicitly — unlike init, there is no default to fall back to. */
const switchBackendTarget = (args: ParsedArgs): StorageConfig => {
  const backend = args.positionals[1] ?? fail("switch-backend requires a target backend: file, sqlite, or postgres");
  return storageConfigFromParts(backend, stringFlag(args, "filename"), stringFlag(args, "url-env"));
};
/** Only `.tasks/` is a tasks workspace; a `.beads/` directory is a migration source, not a root. */
async function rootFrom(from: string): Promise<string | null> {
  // A missing start directory can't be a workspace, and a git spawn with it as
  // cwd fails posix_spawn ENOENT before git can report anything. `tk init`
  // creates the directory below; every other command gets the workspace hint.
  try { await stat(from); } catch { return null; }
  for (const path of await searchPath(from)) { try { await access(join(path, ".tasks")); return path; } catch { /* keep searching */ } }
  // The upward walk stops at the first enclosing `.git`, which is exactly
  // where a linked worktree's own tree ends — it has no `.tasks/` of its
  // own by design. Fall back to the main worktree sharing this repo's
  // `.git`, the same discovery `git worktree` itself uses.
  const commonDir = await gitCommonDir(from);
  if (commonDir === null) return null;
  const mainRoot = mainWorktreeRoot(commonDir);
  try { await access(join(mainRoot, ".tasks")); return mainRoot; } catch { return null; }
}
/**
 * Beads workspaces are never renamed or moved: beads keeps its issues in an
 * embedded Dolt database that only `bd` can read, so moving `.beads/` breaks
 * `bd` without migrating a single issue. Migration is explicit (`tk migrate`)
 * and leaves the source untouched.
 */
/** No .tasks workspace on the way up from `from` — explain what's missing and give a concrete next step, plus a beads-migration path when we spot leftover beads data. */
async function beadsHint(from: string): Promise<string> {
  const found = await findBeadsWorkspace(from);
  if (found === null) {
    return [
      `No ${cyan(".tasks")} workspace found searching up from ${dim(from)}.`,
      "",
      `Run ${cyan("tk init")} to create one here.`,
    ].join("\n");
  }
  return [
    `No ${cyan(".tasks")} workspace found searching up from ${dim(from)}.`,
    `Found existing beads data instead at ${cyan(found.directory)}.`,
    "",
    `Run ${cyan("tk migrate")} to import it into a new .tasks workspace,`,
    `or ${cyan("tk init")} to start fresh with an empty one.`,
  ].join("\n");
}
/** State of a `.tasks/` workspace relative to one worktree, for `tk worktree list/info`. */
async function worktreeTasksState(worktreePath: string, mainRoot: string | null): Promise<{ readonly state: "shared" | "redirect" | "none"; readonly tasksDir: string | null }> {
  const own = join(worktreePath, ".tasks");
  if (await access(own).then(() => true, () => false)) return { state: "shared", tasksDir: own };
  if (mainRoot !== null) { const shared = join(mainRoot, ".tasks"); if (await access(shared).then(() => true, () => false)) return { state: "redirect", tasksDir: shared }; }
  return { state: "none", tasksDir: null };
}
/**
 * Lifecycle provisioning for a worktree tk just created (gw port): `post_start`
 * when the branch is new, `post_checkout` when an existing branch was checked
 * out, then the package-manager install unless `worktree.install` is false.
 * Re-entry of an existing worktree never calls this. Failures become notes,
 * never fatal to the tk command.
 */
async function provisionHooks(path: string, mainRoot: string, worktreeConfig: WorkspaceConfig["worktree"], branchIsNew: boolean): Promise<string[]> {
  const notes: string[] = [];
  const [hookName, command] = branchIsNew ? ["post_start", worktreeConfig?.postStart] as const : ["post_checkout", worktreeConfig?.postCheckout] as const;
  if (command !== undefined && !(await runShellHook(command, path)).ok) notes.push(`${hookName} hook failed`);
  if (worktreeConfig?.install !== false) {
    const setup = await runPackageManagerSetup(path, mainRoot);
    if (setup.ran && !setup.ok) notes.push(`package install failed (${setup.pm ?? "unknown"})`);
  }
  return notes;
}

async function runWorktree(args: ParsedArgs, start: string, json: boolean): Promise<void> {
  const sub = args.positionals[1];
  const commonDir = await gitCommonDir(start);
  if (commonDir === null) fail("not inside a git repository; tk worktree requires git");
  const mainRoot = mainWorktreeRoot(commonDir!);
  if (sub === "list" || sub === undefined) {
    const entries = await gitWorktreeList(start);
    const rows = await Promise.all(entries.map(async (entry) => { const { state } = await worktreeTasksState(entry.path, mainRoot); return { name: entry.path.split("/").filter(Boolean).pop() ?? entry.path, path: entry.path, branch: entry.branch, tasks: state }; }));
    if (json) output(rows, true); else console.log(formatWorktreeList(rows));
    return;
  }
  if (sub === "info") {
    const { state, tasksDir } = await worktreeTasksState(start, mainRoot);
    const branch = await gitCurrentBranch(start);
    const info = { path: start, branch, tasks: state, tasks_dir: tasksDir, main_worktree: mainRoot };
    if (json) output(info, true); else console.log(formatWorktreeInfo(info));
    return;
  }
  if (sub === "create") {
    if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes");
    const name = args.positionals[2] ?? fail("worktree create requires <name>");
    const branch = stringFlag(args, "branch") ?? name;
    const config = await readWorkspaceConfig(join(mainRoot, ".tasks")).catch(() => ({}) as WorkspaceConfig);
    // Same resolver, same root as `tk work`: placement never depends on cwd,
    // so running inside a linked worktree cannot nest a new one under it.
    const placement = resolveWorktreePath({ repoRoot: mainRoot, name, dir: config.worktree?.dir ?? null });
    const path = placement.path;
    const hookNotes: string[] = [];
    if (placement.source === "default") {
      const ignored = await ensureWorktreePoolIgnored(mainRoot);
      if (!ignored.ok) hookNotes.push(`could not exclude .worktrees/: ${ignored.stderr}`);
    }
    // An existing branch is checked out (gw `checkout`), a new one created with -b.
    const branchIsNew = !(await gitBranchExists(mainRoot, branch));
    const outcome = await gitWorktreeAdd(mainRoot, path, branch, branchIsNew);
    if (!outcome.ok) fail(outcome.stderr || `failed to create worktree at ${path}`);
    // No .tasks/ redirect to write: rootFrom() already follows git-common-dir
    // back to the main worktree, exactly like git worktree itself.
    hookNotes.push(...await provisionHooks(path, mainRoot, config.worktree, branchIsNew));
    const result = { name, path, branch, created: true, ...(hookNotes.length > 0 ? { hooks: hookNotes.join("; ") } : {}) };
    const hookSuffix = hookNotes.length > 0 ? dim(` — ${hookNotes.join("; ")}`) : "";
    if (json) output(result, true); else console.log(`${green("\u2713 Created worktree")} ${cyan(path)} on branch ${branch}${hookSuffix}`);
    return;
  }
  if (sub === "remove") {
    if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes");
    const name = args.positionals[2] ?? fail("worktree remove requires <name>");
    const force = booleanFlag(args, "force");
    const entries = await gitWorktreeList(start);
    const target = entries.find((entry) => entry.path.endsWith(`/${name}`)) ?? fail(`no such worktree: ${name}`);
    if (!force) {
      const [dirty, unpushed, stashes] = await Promise.all([gitHasUncommittedChanges(target.path), gitHasUnpushedCommits(target.path), gitStashCount(target.path)]);
      // Merge guard (LC-01): the same predicate every prune path uses. cwd is
      // the target worktree so a detached HEAD resolves to its own commit.
      const base = (await gitDefaultBranch(mainRoot)) ?? (await gitCurrentBranch(mainRoot));
      const merged = base !== null && await gitIsMergedToBase(target.path, base, target.branch ?? "HEAD");
      // Commits already merged into the default branch cannot be lost, so a
      // missing upstream only matters while the branch is unmerged.
      const problems = [dirty ? "uncommitted changes" : null, unpushed && !merged ? "unpushed commits" : null, stashes > 0 ? `${stashes} stash(es)` : null].filter((entry): entry is string => entry !== null);
      if (base === null) problems.push("cannot verify merge: no default branch");
      else if (!merged) problems.push(`branch ${target.branch ?? "detached HEAD"} is not merged into ${base}`);
      if (problems.length > 0) fail(`refusing to remove ${target.path}: ${problems.join(", ")} — use --force to override`);
    }
    // pre_end hook (gw port): run from the worktree before removal; failure is
    // surfaced as a note, never fatal to the removal itself.
    const removeConfig = await readWorkspaceConfig(join(mainRoot, ".tasks")).catch(() => null);
    let preEndNote = "";
    if (removeConfig?.worktree?.preEnd !== undefined) { const hook = await runShellHook(removeConfig.worktree.preEnd, target.path); if (!hook.ok) preEndNote = `pre_end hook failed: ${hook.stderr}`; }
    const outcome = await gitWorktreeRemove(start, target.path, force);
    if (!outcome.ok) fail(outcome.stderr || `failed to remove worktree at ${target.path}`);
    const result = { name, path: target.path, removed: true, ...(preEndNote !== "" ? { hooks: preEndNote } : {}) };
    if (json) output(result, true); else console.log(`${green("\u2713 Removed worktree")} ${cyan(target.path)}${preEndNote === "" ? "" : dim(` — ${preEndNote}`)}`);
    return;
  }
  if (sub === "clean") {
    if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes");
    const yes = booleanFlag(args, "yes");
    if (yes && booleanFlag(args, "dry-run")) fail("--dry-run and --yes are mutually exclusive");
    const store = await openSurfaceStore(mainRoot).catch(() => fail("tk worktree clean requires a .tasks workspace; run tk init"));
    const issues = unwrap(await store.transact(async (uow) => unwrap(await uow.list({ limit: 100_000 })).items));
    const config = await readWorkspaceConfig(join(mainRoot, ".tasks")).catch(() => null);
    // Candidate pass is always a dry run; already-pruned tasks drop out here.
    const candidates: Array<{ readonly id: string; readonly path: string; readonly branch: string; readonly prunable: boolean; readonly reason?: string }> = [];
    for (const issue of issues) {
      if (issue.status !== "closed" || issue.branch === null || issue.branch === "" || typeof issue.metadata["worktree"] !== "string" || issue.metadata["worktree"] === "") continue;
      const changeset = issue.metadata["changeset"];
      const base = changeset !== null && typeof changeset === "object" && !Array.isArray(changeset) && typeof (changeset as Record<string, unknown>)["base"] === "string" ? (changeset as Record<string, unknown>)["base"] as string : null;
      const outcome = await pruneClosedWorktree(mainRoot, { path: issue.metadata["worktree"] as string, branch: issue.branch, base, dryRun: true });
      if (outcome.alreadyPruned === true) continue;
      candidates.push({ id: issue.id, path: issue.metadata["worktree"] as string, branch: issue.branch, prunable: outcome.prunable === true, ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}) });
    }
    const prunable = candidates.filter((entry) => entry.prunable);
    const refused: Array<{ readonly id: string; readonly reason: string | undefined }> = candidates.filter((entry) => !entry.prunable).map((entry) => ({ id: entry.id, reason: entry.reason }));
    if (!yes) {
      const result = { dry_run: true, eligible: prunable.map((entry) => ({ id: entry.id, path: entry.path, branch: entry.branch })), refused };
      if (json) output(result, true); else {
        console.log(`${prunable.length} worktree(s) eligible for pruning:`);
        for (const entry of prunable) console.log(`  ${entry.id}  ${entry.path}  (${entry.branch})`);
        for (const entry of refused) console.log(dim(`  ${entry.id}  kept: ${entry.reason}`));
        if (prunable.length > 0) console.log(dim("run with --yes to remove"));
      }
      return;
    }
    // One removal per eligible task, through the same surface op the close
    // path uses, so metadata.worktreePruned is persisted on the record.
    const removed: Array<{ readonly id: string; readonly path: string; readonly branch: string }> = [];
    for (const entry of prunable) {
      const record = unwrap(await store.transact(async (uow) => {
        const fresh = unwrap(await uow.findById(issueId(entry.id)));
        return fresh === null ? null : await pruneIssueWorktree({ root: mainRoot, tasksDir: join(mainRoot, ".tasks") }, uow, fresh);
      }));
      if (record?.pruned === true) removed.push({ id: entry.id, path: entry.path, branch: entry.branch });
      else refused.push({ id: entry.id, reason: record?.reason ?? "not pruned" });
    }
    const result = { removed, refused };
    if (json) output(result, true); else {
      for (const entry of result.removed) console.log(`${green("\u2713 pruned")} ${entry.id} ${cyan(entry.path)}`);
      for (const entry of result.refused) console.log(dim(`  ${entry.id}  kept: ${entry.reason}`));
    }
    return;
  }
  fail(`unknown worktree subcommand: ${sub}; expected create, list, remove, clean, or info`);
}
/** Human close-line suffix reporting what the auto-prune did (LC-02); empty when the task had no worktree. */
const pruneSuffix = (issue: Issue): string => {
  const record = issue.metadata["worktreePruned"];
  if (record === null || typeof record !== "object" || Array.isArray(record)) return "";
  const { pruned, reason } = record as { pruned?: unknown; reason?: unknown };
  if (pruned === true) return dim(" — worktree pruned");
  if (reason === "already pruned") return dim(" — worktree already pruned");
  return dim(` — worktree kept: ${typeof reason === "string" ? reason : "not pruned"}`);
};
const get = async (uow: IssueUnitOfWork, raw: string): Promise<Issue> => { const issue = unwrap(await uow.findById(issueId(raw))); return issue ?? fail(`issue not found: ${raw}`); };
const transaction = async <T>(database: StorageAdapter, work: (uow: IssueUnitOfWork) => Promise<T>): Promise<T> => unwrap(await database.withinTransaction(async (uow) => { try { return ok(await work(uow)); } catch (cause) { return err({ kind: "repository", operation: "cli", cause }); } }));
const COMMENT_OPS = ["send", "resolve", "dismiss", "reopen"] as const;
type CommentOp = typeof COMMENT_OPS[number];
const isCommentOp = (value: string | undefined): value is CommentOp => value !== undefined && (COMMENT_OPS as readonly string[]).includes(value);
/** `tk comments` positionals in either order: `comments <op> <id> …` or `comments <id> <op> …`; no op → list. */
const commentsArgs = (args: ParsedArgs): { readonly op: CommentOp | "list"; readonly id: string; readonly rest: readonly string[] } => {
  const [, first, second] = args.positionals;
  if (isCommentOp(first)) return { op: first, id: second ?? fail("comments requires issue id"), rest: args.positionals.slice(3) };
  if (isCommentOp(second)) return { op: second, id: first ?? fail("comments requires issue id"), rest: args.positionals.slice(3) };
  return { op: "list", id: first ?? fail("comments requires issue id"), rest: [] };
};
const changed = (issue: Issue, patch: Partial<Issue>): Issue => ({ ...issue, ...patch, updatedAt: new Date() });
/** Repeatable flags arrive as `string | true | readonly string[]`; normalizes to a list. */
const listFlag = (args: ParsedArgs, name: string): readonly string[] => { const value = args.flags.get(name); if (value === undefined || value === true) return []; return typeof value === "string" ? [value] : [...value]; };
const envFlag = (args: ParsedArgs): Record<string, string> => { const entries: Record<string, string> = {}; for (const pair of listFlag(args, "env")) { const split = pair.indexOf("="); if (split <= 0) fail(`invalid --env: ${pair} (expected key=value)`); entries[pair.slice(0, split)] = pair.slice(split + 1); } return entries; };
const accessFlag = (args: ParsedArgs): AgentAccess => AgentAccessSchema.parse(stringFlag(args, "access") ?? "workspace");
const modeFlag = (args: ParsedArgs): AgentMode => AgentModeSchema.parse(stringFlag(args, "mode") ?? "default");
/** Patch from `agent update` flags: only flags present on the command line change, empty owner/runtime clears. */
const agentPatch = (args: ParsedArgs): Partial<Agent> => { const patch: Partial<Agent> = {}; const description = stringFlag(args, "description"); if (description !== undefined) patch.description = description; const owner = args.flags.get("owner"); if (typeof owner === "string") patch.owner = owner === "" ? null : owner; const runtime = args.flags.get("runtime"); if (typeof runtime === "string") patch.runtime = runtime === "" ? null : runtime; if (args.flags.get("access") !== undefined) patch.access = accessFlag(args); if (args.flags.get("mode") !== undefined) patch.mode = modeFlag(args); const instructions = stringFlag(args, "instructions"); if (instructions !== undefined) patch.instructions = instructions; if (args.flags.get("skill") !== undefined) patch.skills = [...listFlag(args, "skill")]; if (args.flags.get("env") !== undefined) patch.env = envFlag(args); return patch; };
/** Recursive byte size of a directory, for `backup` on the `file` backend. */
async function du(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  const entries = await readdir(path);
  const sizes = await Promise.all(entries.map((entry) => du(join(path, entry))));
  return sizes.reduce((total, size) => total + size, 0);
}

class CommandService {
  constructor(private readonly database: StorageAdapter, private readonly root: string, private readonly config: Config, private readonly actor: string, private readonly backend: string, private readonly databasePath: string | null) {}
  private async selected(args: ParsedArgs): Promise<string> { return args.positionals[1] ?? fail("issue id required"); }
  private prefix(): string { return this.config.prefix ?? "tk"; }
  async create(args: ParsedArgs): Promise<Issue> {
    const title = stringFlag(args, "title") ?? args.positionals[1] ?? fail("create requires title"); let description = stringFlag(args, "description") ?? ""; if (booleanFlag(args, "stdin")) description = await readInput();
    return transaction(this.database, async (uow) => {
      const page = unwrap(await uow.list({ limit: 100_000 }));
      const existing = new Set<string>(page.items.map((issue) => issue.id as string));
      const length = idLength(existing.size);
      let candidate = `${this.prefix()}-${generateId().slice(0, length)}`;
      let attempts = 0;
      while (existing.has(candidate)) { attempts += 1; if (attempts > 20) fail("could not allocate unique issue id"); candidate = `${this.prefix()}-${generateId().slice(0, length)}`; }
      const now = new Date(); const parent = stringFlag(args, "parent"); const estimate = stringFlag(args, "estimate");
      const issue: Issue = { id: issueId(candidate), title: issueTitle(title), description: issueDescription(description), status: stringFlag(args, "status") ?? "open", priority: issuePriority(Number(stringFlag(args, "priority") ?? 2)), type: stringFlag(args, "type") ?? "task", owner: stringFlag(args, "owner") ?? null, assignee: stringFlag(args, "assignee") ?? null, createdBy: this.actor, createdAt: now, updatedAt: now, startedAt: null, closedAt: null, dueAt: parseDate(stringFlag(args, "due")) ?? null, deferUntil: parseDate(stringFlag(args, "defer-until")) ?? null, parentId: parent === undefined ? null : issueId(parent), sprintId: null, labels: (stringFlag(args, "labels") ?? stringFlag(args, "label") ?? "").split(",").filter(Boolean), notes: stringFlag(args, "notes") ?? null, design: stringFlag(args, "design") ?? null, acceptanceCriteria: stringFlag(args, "acceptance") ?? null, estimate: estimate === undefined ? null : Number(estimate), specId: stringFlag(args, "spec-id") ?? null, externalRef: stringFlag(args, "external-ref") ?? null, branch: stringFlag(args, "branch") ?? null, metadata: parseMetadata(stringFlag(args, "metadata")) ?? {}, attachments: parseAttachments(args, this.root), wireUnknown: {}, dependencies: [], dependencyCount: 0, dependentCount: 0, comments: [], commentCount: 0 };
      unwrap(await uow.save(issue)); for (const entry of (stringFlag(args, "deps") ?? "").split(",").filter(Boolean)) { const [kind, target] = entry.includes(":") ? entry.split(/:(.*)/s) : ["blocks", entry]; unwrap(await uow.addDependency({ issueId: issue.id, target: dependencyTarget(target!), type: kind!, createdAt: now, createdBy: this.actor, metadata: {}, wireUnknown: {} })); }
      return get(uow, issue.id);
    });
  }
  async show(args: ParsedArgs): Promise<Issue> { return transaction(this.database, (uow) => this.selected(args).then((id) => get(uow, id))); }
  /** `tk show` data plus image-blob bytes for terminals that render them inline; same read-only transaction. */
  async showWithImages(args: ParsedArgs): Promise<readonly [Issue, ReadonlyMap<string, BlobContent>]> {
    const images = new Map<string, BlobContent>();
    const issue = await transaction(this.database, async (uow) => {
      const loaded = await get(uow, await this.selected(args));
      for (const attachment of loaded.attachments) {
        if (!isBlobAttachment(attachment) || !attachment.mime.startsWith("image/")) continue;
        const content = await evidenceReadUow(uow, { root: this.root, tasksDir: join(this.root, ".tasks") }, loaded.id, attachment.id);
        if (content !== null) images.set(attachment.id, content);
      }
      return loaded;
    });
    return [issue, images];
  }
  async all(): Promise<readonly Issue[]> { return transaction(this.database, async (uow) => unwrap(await uow.list({ limit: 100_000 })).items); }
  async history(args: ParsedArgs): Promise<readonly Record<string, unknown>[]> { return transaction(this.database, async (uow) => { const id = issueId(await this.selected(args)); await get(uow, id); return (unwrap(await uow.history(id))).map((entry) => ({ id: entry.id, issue_id: entry.issueId, action: entry.action, at: entry.at.toISOString(), actor: entry.actor, data: entry.data })); }); }
  /** Import is migration of an already-materialised stream: same decoder, same ordering, same atomicity. */
  async importJsonl(input: string): Promise<{ imported: number; sprints: number }> {
    const result = await migrateBeadsJsonl(this.database, input, { onConflict: "overwrite", strict: true, timestamps: canonicalTimestampCodec });
    if (result.ok) return { imported: result.value.imported, sprints: result.value.importedSprints.length };
    const rejected = result.error.rejected?.[0];
    return fail(rejected === undefined ? result.error.message : `import line ${rejected.line} field ${rejected.field}: ${rejected.message}`);
  }
  /** Migrate a beads workspace, reading through `bd export` and never mutating the source. */
  async migrate(args: ParsedArgs): Promise<Record<string, unknown>> {
    const resolved = await resolveBeadsJsonl(this.root, { ...(stringFlag(args, "bd") === undefined ? {} : { executable: stringFlag(args, "bd")! }), preferJsonl: stringFlag(args, "source") === "jsonl" });
    if (!resolved.ok) return fail(resolved.error.message);
    const policy = stringFlag(args, "on-conflict") ?? "skip";
    if (!["skip", "overwrite", "fail"].includes(policy)) fail(`invalid --on-conflict: ${policy} (expected skip, overwrite or fail)`);
    const result = await migrateBeadsJsonl(this.database, resolved.value.jsonl, { onConflict: policy as "skip" | "overwrite" | "fail", dryRun: booleanFlag(args, "dry-run"), timestamps: canonicalTimestampCodec });
    if (!result.ok) return fail(result.error.message);
    const report = migrationReport(result.value, resolved.value.source.kind, resolved.value.source.directory);
    // Adopt the beads prefix, else new issues get a different ID space than the migrated ones.
    const adopted = booleanFlag(args, "keep-prefix") || result.value.dryRun ? null : inferPrefix(result.value.imported > 0 ? result.value.importedIds : result.value.skipped);
    if (adopted === null) return report;
    const tasksDir = join(this.root, ".tasks");
    const current = await readWorkspaceConfig(tasksDir);
    if (current.prefix === adopted) return report;
    await writeWorkspaceConfig(tasksDir, { ...current, prefix: adopted });
    return { ...report, prefix: adopted };
  }
  async list(args: ParsedArgs, ready: boolean): Promise<readonly Issue[]> { const query = statusFilter(args); const sprintFlag = stringFlag(args, "sprint"); const archivedOnly = booleanFlag(args, "archived"); return transaction(this.database, async (uow) => { const page = unwrap(await uow.list({ ...(query === undefined || query === "all" ? {} : { status: query }), limit: Number(stringFlag(args, "limit") ?? 1000) })); const sprintMatches = sprintFlag === undefined ? undefined : await this.sprintFilter(uow, sprintFlag); const hideArchived = !archivedOnly && query !== "all";
    let items = page.items.filter((issue) => (stringFlag(args, "parent") === undefined || issue.parentId === stringFlag(args, "parent")) && (stringFlag(args, "assignee") === undefined || issue.assignee === stringFlag(args, "assignee")) && (stringFlag(args, "type") === undefined || issue.type === stringFlag(args, "type")) && (stringFlag(args, "priority") === undefined || issue.priority === Number(stringFlag(args, "priority"))) && (stringFlag(args, "label") === undefined || issue.labels.includes(stringFlag(args, "label")!)) && (sprintMatches === undefined || sprintMatches(issue)) && (!hideArchived || issue.status !== "archived") && (!archivedOnly || issue.status === "archived"));
    if (!ready) return items; const now = new Date(); items = items.filter((issue) => issue.status === "open" && (issue.deferUntil === null || issue.deferUntil <= now) && !issue.dependencies.some((edge) => edge.type === "blocks" && page.items.some((candidate) => candidate.id === edge.target && candidate.status !== "closed")));
    if (!booleanFlag(args, "claim")) return items; const pick = items[0] ?? fail("no ready issue to claim"); return [unwrap(await uow.claimReady(pick.id, this.actor))]; }); }
  /** Resolves `--sprint <scope>` into an issue matcher: active/current → focus (empty view when none), backlog/none → null sprint, else a slug. */
  private async sprintFilter(uow: IssueUnitOfWork, flag: string): Promise<(issue: Issue) => boolean> {
    const value = flag.trim().toLowerCase();
    if (value === "backlog" || value === "none") return (issue) => issue.sprintId === null;
    if (value === "active" || value === "current") {
      const active = unwrap(await uow.listSprints()).find((candidate) => candidate.status === "active");
      return active === undefined ? () => false : (issue) => issue.sprintId === active.id;
    }
    const id = sprintSlug(value);
    return (issue) => issue.sprintId === id;
  }
  async sprintList(): Promise<readonly Sprint[]> { return transaction(this.database, async (uow) => unwrap(await uow.listSprints())); }
  /** Start a sprint: closes any active sprint first (single-active invariant); its issues go to the backlog unless `carry`. */
  async sprintStart(name: string, carry: boolean): Promise<{ sprint: Sprint; closed: readonly Sprint[]; moved: readonly string[] }> { return transaction(this.database, async (uow) => {
    const trimmed = name.trim(); if (trimmed === "") fail("sprint start requires a name");
    const id = sprintSlug(trimmed); const existing = await uow.findSprint(id); if (existing.ok && existing.value !== null) fail(`sprint already exists: ${id}`);
    const page = unwrap(await uow.list({ limit: 100_000 })); const closed: Sprint[] = []; const moved: string[] = [];
    for (const active of unwrap(await uow.listSprints()).filter((candidate) => candidate.status === "active")) {
      const completed = SprintSchema.parse({ ...active, status: "completed", completedAt: new Date(), updatedAt: new Date() });
      unwrap(await uow.saveSprint(completed)); closed.push(completed);
      for (const issue of page.items.filter((candidate) => candidate.sprintId === active.id)) { unwrap(await uow.save(changed(issue, { sprintId: carry ? id : null }))); moved.push(issue.id); }
    }
    const now = new Date(); const sprint = SprintSchema.parse({ id, name: trimmed, status: "active", completedAt: null, createdAt: now, updatedAt: now, wireUnknown: {} });
    unwrap(await uow.saveSprint(sprint)); return { sprint, closed, moved };
  }); }
  /** Close the active sprint: its issues return to the backlog; the sprint keeps its record. */
  async sprintClose(): Promise<{ sprint: Sprint; moved: readonly string[] }> { return transaction(this.database, async (uow) => {
    const active = unwrap(await uow.listSprints()).find((candidate) => candidate.status === "active") ?? fail("no active sprint");
    const completed = SprintSchema.parse({ ...active, status: "completed", completedAt: new Date(), updatedAt: new Date() });
    unwrap(await uow.saveSprint(completed));
    const page = unwrap(await uow.list({ limit: 100_000 })); const moved: string[] = [];
    for (const issue of page.items.filter((candidate) => candidate.sprintId === active.id)) { unwrap(await uow.save(changed(issue, { sprintId: null }))); moved.push(issue.id); }
    return { sprint: completed, moved };
  }); }
  async sprintAdd(raw: string): Promise<Issue> { return transaction(this.database, async (uow) => { const active = unwrap(await uow.listSprints()).find((candidate) => candidate.status === "active") ?? fail("no active sprint — start one first"); const issue = await get(uow, raw); if (issue.sprintId === active.id) return issue; const result = changed(issue, { sprintId: active.id }); unwrap(await uow.save(result)); return result; }); }
  async sprintRemove(raw: string): Promise<Issue> { return transaction(this.database, async (uow) => { const issue = await get(uow, raw); if (issue.sprintId === null) return issue; const result = changed(issue, { sprintId: null }); unwrap(await uow.save(result)); return result; }); }
  async sprintMove(raw: string, target: string): Promise<Issue> { return transaction(this.database, async (uow) => { const id = sprintSlug(target); const sprint = await uow.findSprint(id); if (!sprint.ok || sprint.value === null) fail(`sprint not found: ${target}`); const issue = await get(uow, raw); if (issue.sprintId === id) return issue; const result = changed(issue, { sprintId: id }); unwrap(await uow.save(result)); return result; }); }
  /** Find an agent by slug or fail; every agent command routes through here. */
  private async agent(uow: IssueUnitOfWork, raw: string): Promise<Agent> { const found = unwrap(await uow.findAgent(agentId(raw))); return found ?? fail(`agent not found: ${raw}`); }
  async agentCreate(args: ParsedArgs): Promise<Agent> { const name = stringFlag(args, "name") ?? args.positionals[2] ?? fail("agent create requires a name"); return transaction(this.database, async (uow) => {
    const id = agentSlug(name); const existing = unwrap(await uow.findAgent(id)); if (existing !== null) fail(`agent already exists: ${id}`);
    const now = new Date(); const agent = AgentSchema.parse({ id, name, description: stringFlag(args, "description") ?? "", owner: stringFlag(args, "owner") ?? null, runtime: stringFlag(args, "runtime") ?? null, access: accessFlag(args), mode: modeFlag(args), status: "offline", instructions: stringFlag(args, "instructions") ?? "", skills: [...listFlag(args, "skill")], env: envFlag(args), archivedAt: null, createdAt: now, updatedAt: now });
    unwrap(await uow.saveAgent(agent)); return agent; }); }
  async agentList(args: ParsedArgs): Promise<readonly Agent[]> { const archivedOnly = booleanFlag(args, "archived"); const status = stringFlag(args, "status"); return transaction(this.database, async (uow) => unwrap(await uow.listAgents()).filter((agent) => ((agent.archivedAt !== null) === archivedOnly) && (status === undefined || agent.status === status))); }
  async agentShow(raw: string): Promise<Agent> { return transaction(this.database, async (uow) => this.agent(uow, raw)); }
  async agentUpdate(args: ParsedArgs, raw: string): Promise<Agent> { return transaction(this.database, async (uow) => { const agent = await this.agent(uow, raw); const patch = agentPatch(args); if (patch.description === undefined && patch.owner === undefined && patch.runtime === undefined && patch.access === undefined && patch.mode === undefined && patch.instructions === undefined && patch.skills === undefined && patch.env === undefined) fail("agent update requires at least one field flag"); const result = AgentSchema.parse({ ...agent, ...patch, updatedAt: new Date() }); unwrap(await uow.saveAgent(result)); return result; }); }
  async agentArchive(raw: string): Promise<Agent> { return transaction(this.database, async (uow) => { const agent = await this.agent(uow, raw); if (agent.archivedAt !== null) return agent; const now = new Date(); const result = AgentSchema.parse({ ...agent, status: "offline", archivedAt: now, updatedAt: now }); unwrap(await uow.saveAgent(result)); return result; }); }
  async agentUnarchive(raw: string): Promise<Agent> { return transaction(this.database, async (uow) => { const agent = await this.agent(uow, raw); if (agent.archivedAt === null) return agent; const result = AgentSchema.parse({ ...agent, status: "offline", archivedAt: null, updatedAt: new Date() }); unwrap(await uow.saveAgent(result)); return result; }); }
  async agentCopy(args: ParsedArgs, raw: string): Promise<Agent> { const name = stringFlag(args, "name") ?? fail("agent copy requires --name <new-name>"); return transaction(this.database, async (uow) => {
    const source = await this.agent(uow, raw); const id = agentSlug(name); const existing = unwrap(await uow.findAgent(id)); if (existing !== null) fail(`agent already exists: ${id}`);
    const now = new Date(); const result = AgentSchema.parse({ ...source, id, name, status: "offline", archivedAt: null, createdAt: now, updatedAt: now });
    unwrap(await uow.saveAgent(result)); return result; }); }
  async agentIssues(args: ParsedArgs, raw: string): Promise<readonly Issue[]> { return transaction(this.database, async (uow) => { const agent = await this.agent(uow, raw); const page = unwrap(await uow.list({ limit: Number(stringFlag(args, "limit") ?? 1000) })); return page.items.filter((issue) => issue.assignee === agent.id); }); }
  async runsList(args: ParsedArgs): Promise<readonly Run[]> { const issueFlag = stringFlag(args, "issue"); const state = stringFlag(args, "state"); return transaction(this.database, async (uow) => { const runs = unwrap(await uow.listRuns(issueFlag === undefined ? undefined : issueId(issueFlag))); return state === undefined ? runs : runs.filter((run) => run.state === RunStateSchema.parse(state)); }); }
  private async run(uow: IssueUnitOfWork, raw: string): Promise<Run> { const found = unwrap(await uow.findRun(runId(raw))); return found ?? fail(`run not found: ${raw}`); }
  async runShow(raw: string): Promise<Run> { return transaction(this.database, async (uow) => this.run(uow, raw)); }
  async runCancel(raw: string): Promise<Run> { return transaction(this.database, async (uow) => { const run = await this.run(uow, raw); if (!isActiveRunState(run.state)) fail(`run is not active: ${run.id} (${run.state})`); const now = new Date(); const result = RunSchema.parse({ ...run, state: "cancelled", closedAt: now, updatedAt: now }); unwrap(await uow.saveRun(result)); return result; }); }
  async runRerun(raw: string): Promise<Run> { return transaction(this.database, async (uow) => { const source = await this.run(uow, raw); const id = unwrap(await nextRunId(uow, source.issueId)); const now = new Date(); const result = RunSchema.parse({ id, issueId: source.issueId, agentId: source.agentId, trigger: "manual", state: "queued", startedAt: null, closedAt: null, messages: [], usage: { tokens: null, cost: null }, createdAt: now, updatedAt: now }); unwrap(await uow.saveRun(result)); return result; }); }
  async runMessage(args: ParsedArgs, raw: string, body: string): Promise<Run> { return transaction(this.database, async (uow) => { const run = await this.run(uow, raw); if (!isActiveRunState(run.state) && run.state !== "in_review") fail(`run is terminal: ${run.id} (${run.state})`); const now = new Date(); const result = RunSchema.parse({ ...run, messages: [...run.messages, { at: now, kind: "log", text: body }], updatedAt: now }); unwrap(await uow.saveRun(result)); return result; }); }
  /** Archive: icebox without deletion — hidden from default views, restorable via `archivedFrom`. */
  async archive(args: ParsedArgs): Promise<Issue> { const id = await this.selected(args); return transaction(this.database, async (uow) => { const issue = await get(uow, id); if (issue.status === "archived") return issue; const result = changed(issue, { status: "archived", metadata: { ...issue.metadata, archivedFrom: issue.status } }); unwrap(await uow.save(result)); return result; }); }
  async unarchive(args: ParsedArgs): Promise<Issue> { const id = await this.selected(args); return transaction(this.database, async (uow) => { const issue = await get(uow, id); if (issue.status !== "archived") return issue; const from = issue.metadata["archivedFrom"]; const metadata = { ...issue.metadata }; delete metadata["archivedFrom"]; const result = changed(issue, { status: typeof from === "string" && from !== "archived" ? from : "open", metadata }); unwrap(await uow.save(result)); return result; }); }
  /** Export = sprints first (import saves them before issues for sprint_id FK ordering), then issues. */
  async exportWire(): Promise<readonly Record<string, unknown>[]> { return transaction(this.database, async (uow) => [...unwrap(await uow.listSprints()).map((sprint) => sprintToBdWire({ version: 1, sprint, unknown: sprint.wireUnknown }, canonicalTimestampCodec)), ...unwrap(await uow.list({ limit: 100_000 })).items.map((issue) => issueToBdWire({ version: 1, issue, unknown: issue.wireUnknown }, canonicalTimestampCodec))]); }
  async comment(args: ParsedArgs): Promise<Issue> { const id = await this.selected(args); let body = args.positionals.slice(2).join(" ") || stringFlag(args, "body") || ""; if (booleanFlag(args, "stdin")) body = await readInput(); if (!body) fail("comment requires body"); return transaction(this.database, async (uow) => { unwrap(await uow.addComment(issueId(id), this.actor, body)); return get(uow, id); }); }
  /** `tk comments <id>`: the task's review comments as cards + counts (D-01). */
  async reviewList(id: string) { return transaction(this.database, (uow) => reviewCommentListUow(uow, id)); }
  /** `tk comments send <id> [cid…]`: every open comment (or the named ones) → sent in one transaction; unknown cids fail before any write. */
  async reviewSend(id: string, only: readonly string[]) {
    return transaction(this.database, async (uow) => {
      if (only.length > 0) { const known = new Set((await reviewCommentListUow(uow, id)).comments.map((card) => card.id)); for (const cid of only) if (!known.has(cid)) fail(`comment not found: ${cid}`); }
      return reviewCommentSendUow(uow, this.actor, id, only.length === 0 ? undefined : only);
    });
  }
  /** `tk comments resolve|dismiss|reopen <id> <cid>`: one move, one `reviewCommentLog` entry (CMT-02). */
  async reviewStatus(id: string, cid: string, status: "resolved" | "dismissed" | "open") { return transaction(this.database, (uow) => reviewCommentSetStatusUow(uow, this.actor, id, cid, status)); }
  async dep(args: ParsedArgs): Promise<Issue | readonly Record<string, unknown>[]> {
    // Accept tuicr form (`dep <op> <id> [other]`) and legacy form (`dep <id> <op> [other]`).
    const operations = new Set(["list", "add", "remove", "relate", "unrelate"]);
    const first = args.positionals[1] ?? fail("dep requires operation");
    const tuicr = operations.has(first);
    const op = tuicr ? first : args.positionals[2] ?? fail("dep requires operation");
    const id = tuicr ? args.positionals[2] ?? fail("dep requires issue id") : first;
    const target = tuicr ? args.positionals[3] : args.positionals[3];
    const dependencyType = (type: string): string => type === "related" ? "relates-to" : type;
    return transaction(this.database, async (uow) => {
      const issue = await get(uow, id);
      if (op === "list") {
        const page = unwrap(await uow.list({ limit: 100_000 }));
        const edge = (other: Issue, type: string): Record<string, unknown> => ({ id: other.id, title: other.title, status: other.status, issue_type: other.type, dependency_type: dependencyType(type) });
        if (stringFlag(args, "direction") === "up") {
          return page.items.flatMap((other) => [
            ...other.dependencies.filter((candidate) => candidate.target === issue.id).map((candidate) => edge(other, candidate.type)),
            ...(other.parentId === issue.id ? [edge(other, "parent-child")] : []),
          ]);
        }
        return [
          ...issue.dependencies.flatMap((candidate) => {
            const other = page.items.find((item) => item.id === candidate.target);
            return other === undefined ? [] : [edge(other, candidate.type)];
          }),
          ...(issue.parentId === null ? [] : (() => { const parent = page.items.find((item) => item.id === issue.parentId); return parent === undefined ? [] : [edge(parent, "parent-child")]; })()),
        ];
      }
      const other = target ?? fail("dep requires target");
      if (op === "add" || op === "relate") unwrap(await uow.addDependency({ issueId: issue.id, target: dependencyTarget(other), type: op === "relate" ? "related" : stringFlag(args, "type") ?? "blocks", createdAt: new Date(), createdBy: this.actor, metadata: {}, wireUnknown: {} }));
      else if (op === "remove" || op === "unrelate") unwrap(await uow.removeDependency(issue.id, dependencyTarget(other), op === "unrelate" ? "related" : undefined));
      else fail("unknown dep operation");
      return get(uow, id);
    });
  }
  async mutate(args: ParsedArgs, command: string): Promise<Issue> { const labelOperation = args.positionals[1]; const tuicrLabel = command === "label" && (labelOperation === "add" || labelOperation === "remove"); const id = command === "label" ? (tuicrLabel ? args.positionals[2] : args.positionals[1]) ?? fail("label requires issue id") : await this.selected(args); return transaction(this.database, async (uow) => { const issue = await get(uow, id); if (command === "update" && booleanFlag(args, "claim")) return unwrap(await uow.claimReady(issue.id, this.actor)); let patch: Partial<Issue> = {};
    if (["close", "reopen", "set-state"].includes(command)) { const status = command === "close" ? "closed" : command === "reopen" ? "open" : args.positionals[2] ?? fail("set-state requires state"); patch = { status, closedAt: status === "closed" ? new Date() : null, startedAt: status === "in_progress" ? issue.startedAt ?? new Date() : issue.startedAt }; const reason = stringFlag(args, "reason"); if (reason !== undefined) patch = { ...patch, notes: [issue.notes, reason].filter(Boolean).join("\n") }; }
    else if (command === "defer") patch = { deferUntil: parseDate(args.positionals[2] ?? stringFlag(args, "until")) ?? new Date(Date.now() + 86_400_000) }; else if (command === "undefer") patch = { deferUntil: null };
    else if (command === "label") { const label = args.positionals[3] ?? fail("label requires value"); patch = { labels: (tuicrLabel ? args.positionals[1] : args.positionals[2]) === "add" ? [...new Set([...issue.labels, label])] : issue.labels.filter((value) => value !== label) }; }
    else if (command === "update") { const fields: ReadonlyArray<readonly [string, keyof Issue, (value: string) => Issue[keyof Issue]]> = [["title", "title", issueTitle], ["description", "description", issueDescription], ["priority", "priority", (value) => issuePriority(Number(value))], ["type", "type", (value) => value], ["assignee", "assignee", (value) => value === "" ? null : value], ["owner", "owner", (value) => value], ["acceptance", "acceptanceCriteria", (value) => value], ["design", "design", (value) => value], ["spec-id", "specId", (value) => value], ["estimate", "estimate", (value) => Number(value)], ["external-ref", "externalRef", (value) => value === "" ? null : value], ["branch", "branch", (value) => value === "" ? null : value], ["parent", "parentId", (value) => value === "" ? null : issueId(value)]]; for (const [flagName, key, parse] of fields) { const raw = stringFlag(args, flagName); if (raw !== undefined) (patch as Record<string, unknown>)[key] = parse(raw); } const metadata = stringFlag(args, "metadata"); if (metadata !== undefined) { const parsed: Metadata = JSON.parse(metadata); patch = { ...patch, metadata: parsed }; } const setMetadata = stringFlag(args, "set-metadata"); if (setMetadata !== undefined) { const [key, value] = metadataEntry(setMetadata); patch = { ...patch, metadata: { ...issue.metadata, ...(patch.metadata ?? {}), [key]: value } }; } const unsetMetadata = stringFlag(args, "unset-metadata"); if (unsetMetadata !== undefined) { const next = { ...issue.metadata, ...(patch.metadata ?? {}) }; delete next[unsetMetadata]; patch = { ...patch, metadata: next }; } const labels = stringFlag(args, "label"); if (labels !== undefined) patch = { ...patch, labels: [...new Set([...issue.labels, ...labels.split(",")])] }; const addLabel = stringFlag(args, "add-label"); if (addLabel !== undefined) patch = { ...patch, labels: [...new Set([...(patch.labels ?? issue.labels), ...addLabel.split(",").filter(Boolean)])] }; const removeLabel = stringFlag(args, "remove-label"); if (removeLabel !== undefined) { const removed = new Set(removeLabel.split(",")); patch = { ...patch, labels: (patch.labels ?? issue.labels).filter((label) => !removed.has(label)) }; } let body = stringFlag(args, "body"); if (booleanFlag(args, "stdin")) body = await readInput(); if (body !== undefined) patch = { ...patch, description: issueDescription(body) }; const notes = stringFlag(args, "append-notes"); if (notes !== undefined) patch = { ...patch, notes: [issue.notes, notes].filter(Boolean).join("\n") }; } else fail(`unknown command: ${command}`);
    const status = stringFlag(args, "status"); if (status !== undefined) patch = { ...patch, status }; const due = parseDate(stringFlag(args, "due")); if (due !== undefined) patch = { ...patch, dueAt: due };
    if (command === "update" && (args.flags.get("attach") !== undefined || stringFlag(args, "plan") !== undefined)) { const incoming = parseAttachments(args, this.root); const planPaths = new Set(stringFlag(args, "plan") === undefined ? [] : incoming.filter((entry) => entry.metadata["kind"] === "plan").map((entry) => entry.path)); const merged: IssueAttachment[] = [...issue.attachments.filter((entry) => isBlobAttachment(entry) || (!planPaths.has(entry.path) && !(planPaths.size > 0 && entry.metadata["kind"] === "plan")))]; for (const attachment of incoming) { const existing = merged.findIndex((entry) => !isBlobAttachment(entry) && entry.path === attachment.path); if (existing >= 0) merged[existing] = attachment; else merged.push(attachment); } patch = { ...patch, attachments: merged }; }
    if (command === "update" && stringFlag(args, "detach") !== undefined) { const target = stringFlag(args, "detach")!; const blobTarget = issue.attachments.find((entry) => isBlobAttachment(entry) && (entry.id === target || entry.name === target)); patch = { ...patch, attachments: blobTarget !== undefined ? (await detachBlobUow(uow, { root: this.root, tasksDir: join(this.root, ".tasks") }, id, target)).attachments : issue.attachments.filter((entry) => isBlobAttachment(entry) || entry.path !== target) }; }
    // CHG-02: a close freezes the terminal changeset snapshot exactly once —
    // derived live from git, never caller input; merge before the single save.
    if (patch.status === "closed") { const frozen = await freezeChangesetUow(uow, { cwd: this.root }, issue, "closed"); if (frozen !== null) patch = { ...patch, metadata: { ...issue.metadata, ...patch.metadata, changeset: frozen } }; }
    const result = changed(issue, patch); unwrap(await uow.save(result)); if (patch.status !== undefined && patch.status !== issue.status) await applyRunSideEffects(uow, result, issue.status, result.status, new Date());
    // Step 11 (gw port): auto-prune the recorded worktree on close — non-fatal, reason recorded on the issue.
    if (patch.status === "closed") { const pruned = await pruneIssueWorktree({ root: this.root, tasksDir: join(this.root, ".tasks") }, uow, result); if (pruned !== null) return { ...result, metadata: { ...result.metadata, worktreePruned: pruned } }; }
    return result; }); }

  /** `tk finish <id> --session <sid>`: the single completion path into `ready-to-review` (FIN-01). */
  async finish(args: ParsedArgs): Promise<Issue> {
    const id = await this.selected(args);
    const session = stringFlag(args, "session") ?? process.env["TK_SESSION"] ?? "";
    if (session.trim() === "") fail("finish requires --session <sid> (or TK_SESSION env)");
    // D-01: --harness > TK_HARNESS > registry env detection > registry default — always recorded.
    const harness = [stringFlag(args, "harness"), process.env["TK_HARNESS"]].find((value) => value !== undefined && value !== null && value.trim() !== "") ?? detectHarness(process.env);
    return transaction(this.database, async (uow) => finishIssueUow(uow, { cwd: this.root }, id, session, new Date(), harness));
  }
  /**
   * `tk pr create|sync|close|merge|show <id>` and bare `tk pr <id>` (PR-01, D-01). gh/git run outside the store
   * transaction (surface `prCreate`/`prSync`/`prClose`/`prMerge`); show reads the local mirror only.
   * close/merge keep the branch and worktree and never close the task (pruning stays `tk close`'s job).
   */
  async pr(args: ParsedArgs, base: string): Promise<{ readonly op: "create" | "adopt" | "refresh" | "sync" | "close" | "merge" | "show"; readonly id: string; readonly pr: PrRecord | null }> {
    const subs = ["create", "sync", "close", "merge", "show"];
    const first = args.positionals[1] ?? fail("pr requires an issue id (tk pr <id> | tk pr create|sync|close|merge|show <id>)");
    const sub = subs.includes(first) ? first : args.positionals[2] === undefined ? "show" : fail(`unknown pr subcommand: ${first} (expected ${subs.join(", ")})`);
    const id = sub === "show" && first !== "show" ? first : args.positionals[2] ?? fail(`pr ${sub} requires issue id`);
    const deps = { cwd: this.root, transact: <T>(fn: (uow: IssueUnitOfWork) => Promise<T>) => transaction(this.database, fn), webBase: base };
    if (sub === "show") { const shown = await prShow(deps, id); return { op: "show", id: shown.issue.id, pr: shown.pr }; }
    if (sub === "create") { const title = stringFlag(args, "title"); const body = stringFlag(args, "body"); const created = await prCreate(deps, id, { ...(title === undefined ? {} : { title }), ...(body === undefined ? {} : { body }) }); return { op: created.op, id: created.issue.id, pr: created.pr }; }
    if (sub === "sync") { const synced = await prSync(deps, id); return { op: "sync", id: synced.issue.id, pr: synced.pr }; }
    if (sub === "close") { const closed = await prClose(deps, id); return { op: "close", id: closed.issue.id, pr: closed.pr }; }
    // merge: closed method enum from flags (default --merge); never --admin, never --delete-branch (T-11-11).
    const methods = PR_MERGE_METHODS.filter((method) => booleanFlag(args, method));
    if (methods.length > 1) fail("pick one of --merge, --squash, --rebase");
    const merged = await prMerge(deps, id, methods[0] ?? "merge");
    return { op: "merge", id: merged.issue.id, pr: merged.pr };
  }
  /** Quick capture (`bd q`): create and return only the new id. */
  async quick(args: ParsedArgs): Promise<string> { return (await this.create(args)).id; }
  /** Field shorthand used by `assign`/`priority`: patch one field on the selected issue. */
  async fieldPatch(args: ParsedArgs, key: "assignee", value: string): Promise<Issue>;
  async fieldPatch(args: ParsedArgs, key: "priority", value: number): Promise<Issue>;
  async fieldPatch(args: ParsedArgs, key: "assignee" | "priority", value: string | number): Promise<Issue> { const id = await this.selected(args); return transaction(this.database, async (uow) => { const issue = await get(uow, id); const patch: Partial<Issue> = key === "assignee" ? { assignee: String(value) } : { priority: issuePriority(Number(value)) }; const result = changed(issue, patch); unwrap(await uow.save(result)); return result; }); }
  async note(args: ParsedArgs, body: string): Promise<Issue> { const id = await this.selected(args); return transaction(this.database, async (uow) => { const issue = await get(uow, id); const result = changed(issue, { notes: [issue.notes, body].filter(Boolean).join("\n") }); unwrap(await uow.save(result)); return result; }); }
  /** `tk attach <id> <path...>`: record path refs; `--evidence <path...>` ingests blobs (slug identity replaces in place). */
  async attach(args: ParsedArgs): Promise<Issue> {
    const evidence = args.flags.get("evidence");
    const evidencePaths = (evidence === undefined ? [] : Array.isArray(evidence) ? evidence : [evidence]).filter((value): value is string => typeof value === "string" && value !== "");
    if (evidencePaths.length === 0) {
      const paths = args.positionals.slice(2).filter((value): value is string => value !== undefined);
      if (paths.length === 0) fail("attach requires a file path or --evidence <path>");
      const id = await this.selected(args);
      const entries = parseAttachmentEntries(paths.map((entry) => { const separator = entry.indexOf("="); return separator > 0 ? [entry.slice(0, separator), entry.slice(separator + 1)] as const : [entry, undefined] as const; }), this.root, stringFlag(args, "attach-metadata"));
      return transaction(this.database, async (uow) => { let issue = await get(uow, id); for (const entry of entries) issue = await attachPathUow(uow, id, entry.path, entry.metadata); return issue; });
    }
    const id = await this.selected(args);
    return transaction(this.database, (uow) => attachEvidenceUow(uow, { root: this.root, tasksDir: join(this.root, ".tasks") }, id, evidencePaths));
  }
  /** `tk detach <id> <path|name|id>`: remove one attachment; blob entries lose their stored bytes too. */
  async detach(args: ParsedArgs): Promise<Issue> {
    const ref = args.positionals[2] ?? stringFlag(args, "detach") ?? fail("detach requires a file path");
    const id = await this.selected(args);
    return transaction(this.database, async (uow) => {
      const issue = await get(uow, id);
      if (issue.attachments.some((entry) => !isBlobAttachment(entry) && entry.path === ref)) {
        const attachments = issue.attachments.filter((entry) => isBlobAttachment(entry) || entry.path !== ref);
        if (attachments.length === issue.attachments.length) return issue;
        const result = changed(issue, { attachments });
        unwrap(await uow.save(result));
        return result;
      }
      return detachBlobUow(uow, { root: this.root, tasksDir: join(this.root, ".tasks") }, id, ref);
    });
  }
  async tag(args: ParsedArgs, label: string): Promise<Issue> { const id = await this.selected(args); return transaction(this.database, async (uow) => { const issue = await get(uow, id); const result = changed(issue, { labels: [...new Set([...issue.labels, label])] }); unwrap(await uow.save(result)); return result; }); }
  /** Children of a parent issue. */
  async children(args: ParsedArgs): Promise<readonly Issue[]> { const id = await this.selected(args); return transaction(this.database, async (uow) => unwrap(await uow.list({ limit: 100_000 })).items.filter((issue) => issue.parentId === id)); }
  /** Epic view: the epic plus its children, with per-status progress. */
  async epic(args: ParsedArgs): Promise<{ readonly epic: Issue; readonly children: readonly Issue[]; readonly done: number; readonly eligible: boolean }> { const id = await this.selected(args); return transaction(this.database, async (uow) => { const epicIssue = await get(uow, id); const children = unwrap(await uow.list({ limit: 100_000 })).items.filter((issue) => issue.parentId === epicIssue.id); const done = children.filter((issue) => issue.status === "closed").length; return { epic: epicIssue, children, done, eligible: children.length > 0 && done === children.length && epicIssue.status !== "closed" }; }); }
  /** Core of `rename`: retarget parents/deps for `from` → `to` within an already-open transaction. */
  private async renameOne(uow: IssueUnitOfWork, page: { readonly items: readonly Issue[] }, from: string, to: string): Promise<void> {
    const issue = await get(uow, from);
    if (unwrap(await uow.findById(issueId(to))) !== null) fail(`issue already exists: ${to}`);
    unwrap(await uow.save({ ...issue, id: issueId(to), dependencies: issue.dependencies.map((edge) => ({ ...edge, issueId: issueId(to) })), updatedAt: new Date() }));
    for (const other of page.items) {
      if (other.id === issue.id) continue;
      let touched = false; let next = other;
      if (other.parentId === from) { next = { ...next, parentId: issueId(to) }; touched = true; }
      for (const edge of other.dependencies.filter((candidate) => candidate.target === from)) { unwrap(await uow.removeDependency(other.id, dependencyTarget(from), edge.type)); unwrap(await uow.addDependency({ ...edge, target: dependencyTarget(to), issueId: other.id })); }
      if (touched) unwrap(await uow.save({ ...next, updatedAt: new Date() }));
    }
    unwrap(await uow.delete(issue.id));
  }
  /** Rename an issue id, retargeting parents and dependencies that reference it. */
  async rename(args: ParsedArgs): Promise<{ readonly from: string; readonly to: string }> { const from = args.positionals[1] ?? fail("rename requires old id"); const to = args.positionals[2] ?? fail("rename requires new id"); return transaction(this.database, async (uow) => { const page = unwrap(await uow.list({ limit: 100_000 })); await this.renameOne(uow, page, from, to); return { from, to }; }); }
  /** Delete one or more issues, cleaning references (`bd delete`). */
  async remove(args: ParsedArgs): Promise<readonly string[]> { const ids = args.positionals.slice(1); if (ids.length === 0) fail("delete requires at least one id"); return transaction(this.database, async (uow) => { for (const id of ids) await get(uow, id); for (const id of ids) unwrap(await uow.delete(issueId(id))); return ids; }); }
  /** `bd link`: shorthand for `dep add`, default type "blocks", id2 blocks id1. */
  async link(args: ParsedArgs): Promise<Issue> { const id = args.positionals[1] ?? fail("link requires <id1> <id2>"); const target = args.positionals[2] ?? fail("link requires <id1> <id2>"); const type = stringFlag(args, "type") ?? "blocks"; return transaction(this.database, async (uow) => { const issue = await get(uow, id); await get(uow, target); unwrap(await uow.addDependency({ issueId: issue.id, target: dependencyTarget(target), type, createdAt: new Date(), createdBy: this.actor, metadata: {}, wireUnknown: {} })); return get(uow, id); }); }
  /** `bd duplicate <id> --of <canonical>`: close id, record canonical in notes. */
  async markDuplicate(args: ParsedArgs): Promise<Issue> { const id = args.positionals[1] ?? fail("duplicate requires <id>"); const canonical = stringFlag(args, "of") ?? fail("duplicate requires --of <canonical>"); return transaction(this.database, async (uow) => { const issue = await get(uow, id); await get(uow, canonical); const result = changed(issue, { status: "closed", closedAt: new Date(), notes: [issue.notes, `Duplicate of ${canonical}`].filter(Boolean).join("\n") }); const frozen = await freezeChangesetUow(uow, { cwd: this.root }, result, "closed"); const merged = frozen === null ? result : { ...result, metadata: { ...result.metadata, changeset: frozen } }; unwrap(await uow.save(merged)); const pruned = await pruneIssueWorktree({ root: this.root, tasksDir: join(this.root, ".tasks") }, uow, merged); return pruned === null ? merged : { ...merged, metadata: { ...merged.metadata, worktreePruned: pruned } }; }); }
  /** `bd supersede <id> --with <new>`: close id, record replacement in notes. */
  async markSuperseded(args: ParsedArgs): Promise<Issue> { const id = args.positionals[1] ?? fail("supersede requires <id>"); const replacement = stringFlag(args, "with") ?? fail("supersede requires --with <new>"); return transaction(this.database, async (uow) => { const issue = await get(uow, id); await get(uow, replacement); const result = changed(issue, { status: "closed", closedAt: new Date(), notes: [issue.notes, `Superseded by ${replacement}`].filter(Boolean).join("\n") }); const frozen = await freezeChangesetUow(uow, { cwd: this.root }, result, "closed"); const merged = frozen === null ? result : { ...result, metadata: { ...result.metadata, changeset: frozen } }; unwrap(await uow.save(merged)); const pruned = await pruneIssueWorktree({ root: this.root, tasksDir: join(this.root, ".tasks") }, uow, merged); return pruned === null ? merged : { ...merged, metadata: { ...merged.metadata, worktreePruned: pruned } }; }); }
  /** `bd todo`: task-type issues, with `add`/`done`/`list` shortcuts. */
  async todoAdd(args: ParsedArgs): Promise<Issue> { const title = args.positionals.slice(2).join(" ") || fail("todo add requires title"); return this.create({ ...args, positionals: [args.positionals[0]!, title], flags: new Map([...args.flags, ["type", "task"]]) }); }
  // WR-01: todo done is a close path too — freeze CHG-02 exactly once (branch-less items derive null).
  async todoDone(args: ParsedArgs): Promise<readonly Issue[]> { const ids = args.positionals.slice(2); if (ids.length === 0) fail("todo done requires at least one id"); const reason = stringFlag(args, "reason") ?? "Completed"; return transaction(this.database, async (uow) => { const results: Issue[] = []; for (const id of ids) { const issue = await get(uow, id); const result = changed(issue, { status: "closed", closedAt: new Date(), notes: [issue.notes, reason].filter(Boolean).join("\n") }); const frozen = await freezeChangesetUow(uow, { cwd: this.root }, result, "closed"); const merged = frozen === null ? result : { ...result, metadata: { ...result.metadata, changeset: frozen } }; unwrap(await uow.save(merged)); const pruned = await pruneIssueWorktree({ root: this.root, tasksDir: join(this.root, ".tasks") }, uow, merged); results.push(pruned === null ? merged : { ...merged, metadata: { ...merged.metadata, worktreePruned: pruned } }); } return results; }); }
  async todoList(all: boolean): Promise<readonly Issue[]> { return transaction(this.database, async (uow) => unwrap(await uow.list({ limit: 100_000 })).items.filter((issue) => issue.type === "task" && (all || issue.status !== "closed"))); }
  /** `bd lint`: flag issues missing recommended markdown sections for their type. */
  async lint(args: ParsedArgs): Promise<ReadonlyArray<{ readonly issue: Issue; readonly missing: readonly string[] }>> {
    const ids = args.positionals.slice(1); const typeFilter = stringFlag(args, "type"); const status = statusFilter(args) ?? "open";
    const all = await this.all();
    const scope = ids.length > 0 ? all.filter((issue) => ids.includes(issue.id)) : all.filter((issue) => (status === "all" || issue.status === status) && (typeFilter === undefined || issue.type === typeFilter));
    return scope.flatMap((issue) => {
      const required = LINT_SECTIONS[issue.type] ?? [];
      const body = `${issue.description}\n${issue.acceptanceCriteria ?? ""}`;
      const missing = required.filter((section) => !new RegExp(`##\\s*${section}`, "i").test(body));
      return missing.length === 0 ? [] : [{ issue, missing }];
    });
  }
  /** `bd backup`: filesystem copy of the database (sqlite file, or the whole `file` backend dir). */
  async backup(args: ParsedArgs): Promise<{ readonly path: string; readonly bytes: number }> {
    if (this.backend === "postgres") fail("backup is not supported for the postgres backend; use pg_dump");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = args.positionals[1] ?? join(this.root, `.tasks-backup-${stamp}${this.backend === "sqlite" ? ".db" : ""}`);
    if (this.backend === "sqlite") { const source = this.databasePath ?? fail("backup requires a file-backed database"); await copyFile(source, destination); const bytes = (await stat(destination)).size; return { path: destination, bytes }; }
    const source = this.databasePath ?? join(this.root, ".tasks");
    await cp(source, destination, { recursive: true });
    const bytes = await du(destination);
    return { path: destination, bytes };
  }
  /** `bd rename-prefix <new-prefix>`: rewrite every issue id's prefix, retargeting all references. */
  async renamePrefix(args: ParsedArgs): Promise<{ readonly from: readonly string[]; readonly to: string; readonly renamed: number; readonly dryRun: boolean }> {
    const to = args.positionals[1] ?? fail("rename-prefix requires <new-prefix>");
    if (!/^[a-z][a-z0-9-]*-$/.test(to) || to.length > 8) fail("invalid prefix: must start with a letter, end with '-', max 8 chars, lowercase letters/numbers/hyphens");
    const dryRun = booleanFlag(args, "dry-run");
    return transaction(this.database, async (uow) => {
      const page = unwrap(await uow.list({ limit: 100_000 }));
      const from = [...new Set(page.items.map((issue) => issue.id.replace(/^([a-z][a-z0-9-]*-).+$/, "$1")))];
      if (dryRun) return { from, to, renamed: page.items.length, dryRun };
      // Compute the full id mapping up front, then rewrite every issue in one pass
      // instead of chaining single-issue renames — chaining reads a stale full-list
      // snapshot on each iteration and recreates dependency edges against ids that
      // an earlier iteration in the same batch already deleted.
      const mapping = new Map<string, string>();
      for (const issue of page.items) { const suffix = issue.id.replace(/^[a-z][a-z0-9-]*-/, ""); const nextId = `${to}${suffix}`; if (nextId !== issue.id) mapping.set(issue.id, nextId); }
      const remap = (id: string): string => mapping.get(id) ?? id;
      for (const issue of page.items) {
        const nextId = mapping.get(issue.id);
        if (nextId === undefined) continue;
        unwrap(await uow.save({
          ...issue, id: issueId(nextId),
          parentId: issue.parentId === null ? null : issueId(remap(issue.parentId)),
          dependencies: issue.dependencies.map((edge) => ({ ...edge, issueId: issueId(nextId), target: dependencyTarget(remap(edge.target)) })),
          updatedAt: new Date(),
        }));
      }
      for (const issue of page.items) if (mapping.has(issue.id)) unwrap(await uow.delete(issue.id));
      const tasksDir = join(this.root, ".tasks"); const currentConfig = await readWorkspaceConfig(tasksDir); await writeWorkspaceConfig(tasksDir, { ...currentConfig, prefix: to.replace(/-$/, "") });
      return { from, to, renamed: mapping.size, dryRun };
    });
  }

  /**
   * `tk work <id>` — create or re-enter the task's worktree on branch `tk/<id>`
   * and record the PR container evidence on the issue: branch, worktree path,
   * and the base SHA pinned once at creation. Every recorded value comes from
   * an actual git operation's output — never caller- or agent-supplied lists.
   */
  async work(args: ParsedArgs): Promise<{ readonly value: Record<string, unknown>; readonly human: (() => string) | null }> {
    const raw = args.positionals[1] ?? fail("work requires an issue id");
    if (raw.trim() === "") fail("work requires a non-empty issue id");
    const commonDir = await gitCommonDir(this.root);
    const mainRoot = mainWorktreeRoot(commonDir === null ? fail("tk work requires a git repository") : commonDir);
    const issue = await transaction(this.database, (uow) => get(uow, raw));
    const workspaceConfig = await readWorkspaceConfig(join(mainRoot, ".tasks")).catch(() => ({}) as WorkspaceConfig);
    const override = typeof issue.metadata["worktree_dir"] === "string" ? (issue.metadata["worktree_dir"] as string) : null;
    const branch = `tk/${issue.id}`;
    const placement = resolveWorktreePath({ repoRoot: mainRoot, name: `${basename(mainRoot)}-${issue.id}`, dir: workspaceConfig.worktree?.dir ?? null, override });
    const entries = await gitWorktreeList(mainRoot);
    const existing = entries.find((entry) => entry.branch === branch) ?? entries.find((entry) => entry.path === placement.path);
    let path: string;
    let created = false;
    let hookNote = "";
    if (existing !== undefined) {
      path = existing.path;
    } else {
      const hookNotes: string[] = [];
      const branchExists = await gitBranchExists(mainRoot, branch);
      let createdBranchHere = false;
      if (!branchExists) {
        const createdBranch = await gitCreateBranch(mainRoot, branch);
        if (!createdBranch.ok) fail(createdBranch.stderr || `failed to create branch ${branch}`);
        createdBranchHere = true;
      }
      if (placement.source === "default") {
        const ignored = await ensureWorktreePoolIgnored(mainRoot);
        if (!ignored.ok) hookNotes.push(`could not exclude .worktrees/: ${ignored.stderr}`);
      }
      const outcome = await gitWorktreeAdd(mainRoot, placement.path, branch, false);
      if (!outcome.ok) {
        const message = outcome.stderr || `failed to create worktree at ${placement.path}`;
        // Roll back only a branch this invocation created (just made at HEAD,
        // so `-d` succeeds); a pre-existing tk/<id> is never touched.
        if (!createdBranchHere) fail(message);
        const rollback = await gitDeleteBranch(mainRoot, branch, false);
        fail(rollback.ok ? message : `${message}; also failed to remove branch ${branch}: ${rollback.stderr}`);
      }
      path = placement.path;
      created = true;
      // Lifecycle hooks (gw port): post_start when this invocation created
      // tk/<id>, post_checkout when the branch survived from earlier; failures
      // are notes, never fatal to `tk work`.
      hookNotes.push(...await provisionHooks(path, mainRoot, workspaceConfig.worktree, !branchExists));
      hookNote = hookNotes.join("; ");
    }
    const usedBranch = existing?.branch ?? branch;
    const defaultBranch = await gitDefaultBranch(mainRoot);
    let base: string | null = null;
    let note = "";
    if (defaultBranch === null) note = "base unpinned: no default branch (no origin/HEAD, no main/master)";
    else {
      base = await gitMergeBase(mainRoot, usedBranch, defaultBranch);
      if (base === null) note = `base unpinned: could not resolve merge base of ${usedBranch} and ${defaultBranch}`;
    }
    const updated = await transaction(this.database, async (uow) => {
      const current = await get(uow, raw);
      const priorRaw = current.metadata["changeset"];
      const prior: Metadata = priorRaw !== null && typeof priorRaw === "object" && !Array.isArray(priorRaw) ? priorRaw as Metadata : {};
      const changeset: Metadata = { ...prior };
      // Only the base SHA is pinned here; commits/files/diff derive lazily later.
      // An existing recorded base is never rewritten on re-entry.
      if (base !== null && (typeof prior["base"] !== "string" || prior["base"] === "")) changeset["base"] = base;
      const recordedBase = typeof changeset["base"] === "string" && changeset["base"] !== "" ? changeset["base"] : null;
      unwrap(await uow.save(changed(current, { branch: usedBranch, metadata: { ...current.metadata, worktree: path, changeset } })));
      return { id: current.id, recordedBase };
    });
    if (hookNote !== "") note = note === "" ? hookNote : `${note}; ${hookNote}`;
    return { value: { id: updated.id, path, branch: usedBranch, base: updated.recordedBase, created, ...(hookNote !== "" ? { hooks: hookNote } : {}) }, human: () => green(`✓ worktree ready at ${cyan(path)} (branch ${usedBranch})`) + (created ? "" : dim(" (existing)")) + (note !== "" ? dim(` — ${note}`) : "") };
  }
}

/** Stable machine-readable migration contract; every non-imported record is accounted for. */
const migrationReport = (summary: MigrationSummary, source: string, directory: string): Record<string, unknown> => ({
  migrated: !summary.dryRun, dry_run: summary.dryRun, source, source_path: directory,
  read: summary.read, imported: summary.imported, sprints: summary.importedSprints.length,
  skipped: [...summary.skipped], overwritten: [...summary.overwritten],
  carried: summary.carried.map((record) => ({ line: record.line, type: record.type })),
  rejected: summary.rejected.map((record) => ({ line: record.line, field: record.field, message: record.message })),
  detached_parents: summary.detachedParents.map((entry) => ({ id: entry.issueId, parent: entry.parentId })),
  cycles: summary.cycles.map((cycle) => [...cycle.members]),
});



const queryIssues = (items: readonly Issue[], expression: string): readonly Issue[] => {
  const match = expression.trim().match(/^([a-z_]+)\s*(=|!=|~)\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_.-]+))$/i);
  if (!match) fail("invalid query: supported fields are id, status, type, priority, assignee, owner, label, title; operators =, !=, ~");
  const valid = match!; const [, field, operator, quotedDouble, quotedSingle, bare] = valid; const value = quotedDouble ?? quotedSingle ?? bare ?? "";
  const values = (issue: Issue): readonly string[] => { switch (field!) { case "id": return [issue.id]; case "status": return [issue.status]; case "type": return [issue.type]; case "priority": return [String(issue.priority)]; case "assignee": return [issue.assignee ?? ""]; case "owner": return [issue.owner ?? ""]; case "label": return issue.labels; case "title": return [issue.title]; default: return fail(`invalid query field: ${field}`); } };
  return items.filter((issue) => { const candidate = values(issue); return operator === "=" ? candidate.includes(value) : operator === "!=" ? !candidate.includes(value) : candidate.some((entry) => entry.toLowerCase().includes(value.toLowerCase())); });
};

const HELP = `tk - Task Tracker

WORKING WITH ISSUES
  create <title> [opts]   Create issue (-t type, -p priority, --labels, --deps, --parent, --assignee)
  q <title>               Quick capture: create and print only the ID
  show <id>               Show issue details
  list [--status <s>]     List issues (filters: --parent --assignee --type --priority --label; shorthands: --open --closed --all --ready-to-review --approved --rejected)
  ready [--claim]         List ready (unblocked) issues
  blocked                 List blocked issues
  update <id> [flags]     Update fields (--title --status --branch ...)
  close <id> [--reason]   Close issue
  reopen <id>             Reopen closed issue
  defer <id> [until]      Defer issue (default: +24h)
  undefer <id>            Restore deferred issue
  comment <id> <body>     Add comment (--stdin for pipe)
  comments <id> [--json]  Review comments (location, status, author, body)
  comments send <id> [cid…]  Send open review comments to the agent as one batch
  comments resolve|dismiss|reopen <id> <cid>  ✓ done / ✕ remove / reopen one comment
  note <id> <text>        Append a note
  attach <id> <path>      Attach a file path (--attach-metadata k=v,k2=v2); --evidence <path>... ingests blobs instead
  detach <id> <ref>       Remove one attachment: path, blob name, or blob id (evidence bytes deleted with it)
  create/update --plan <path>  Set the issue plan file (kind=plan attachment; replaces prior plan)
  assign <id> <user>      Set assignee
  priority <id> <0-4>     Set priority
  tag <id> <label>        Add a label
  label add|rm <id> <l>   Manage labels
  dep <id> add|rm <t>     Manage dependencies (also: relate, unrelate, list)
  delete <id> [ids...]    Delete issues and clean up references
  rename <old> <new>      Rename an issue ID (retargets deps/parents)
  rename-prefix <p-> [--dry-run]  Rename every issue's prefix
  link <id1> <id2>        Shorthand for dep add (id2 blocks id1)
  duplicate <id> --of <c> Mark id as a duplicate of a canonical issue
  supersede <id> --with <n>  Mark id as superseded by a newer issue
  todo add|done|list      Manage TODOs (task-type issue shortcuts)
  search <text>           Full-text search
  query <expr>            Structured query (status=open, title~bug)
  history <id>            Show audit history

  tui [workspace] [tk://route]
                         Launch the terminal UI (board, kanban, graph, insights);
                         a tk:// deep link boots straight into that state, e.g.
                         'tk://task/<id>', 'tk://board', 'tk://composer/create'
  web [workspace|stop|port] [-d] [--open] [--port N]
                          Web UI over the workspace (-d: daemon; --dev dev mode; --open
                          open browser; port: --port, TK_WEB_PORT, or config webPort
                          (default 21579); one shared interface — running it again from
                          another workspace repoints it; stop: shut the live instance;
                          port: print its URL)
  daemon [start|status|stop|restart] [--json] [--idle-ms N]
                          Manage the per-workspace daemon (tkd): start (or bootstrap
                          via tk web), status (ping + hosted web URL; --quiet exits 1
                          when down), stop, restart. --idle-ms sets idle exit delay.
  watch [<id>…] --until "<query>" [--timeout 30m] | --drain | --follow "<query>"
            [--json] [--as <name>] [--from <seq>] [--peek]
                          Read the event log (.tasks/events.jsonl) from this subscriber's
                          cursor: --until blocks for the first match (exit 124 on timeout),
                          --drain prints what was missed, --follow streams until Ctrl-C
                          query: task=a|b,status=approved|rejected,type=task.comment,
                          owner=me,actor=x,mine (comma = AND, | = or); ids add task=
  watch [--kinds k1,k2] [--ids id1,id2] [--label l] [--interval ms] [--after seq]
                          Frame mode (no --until/--drain/--follow): NDJSON ready/event frames
  runtime list            Live watcher registry (id, pid, heartbeat age)
  runtime activity [-l N] Last N runtime activity rows
  inbox [--all]           Run inbox, unread first (--all includes archived)
  inbox read|archive <runId>  Mark a run read or archived
  tree [--all] [--depth N]  Tree view: epics first, priority-ordered dependency fan-out
  count                   Summary counts
  status                  Counts by status
  stats                   Database overview
  types                   List issue types
  statuses                List issue statuses
  stale [--days N]        Issues not updated recently (default 14d)
  duplicates              Find semantically similar issues
  orphans                 Open issues with no assignee/labels/deps
  graph [id]              Dependency tree (whole board or one root)
  epic <id>               Epic progress with child status
  children <id>           List children of a parent
  lint [ids...]           Flag issues missing recommended sections

SYNC & DATA
  export                  Export all issues as JSONL
  import                  Import JSONL from stdin
  migrate [--dry-run]     Migrate a beads workspace into .tasks/
  backup [path]           Copy the database for off-machine recovery
  switch-backend <name>   Move data to file/sqlite/postgres (tk switch-backend --help)

SETUP
  init [--prefix <p>] [--backend ...]  Initialize .tasks/ workspace (tk init --help for backend flags)
  where                   Show workspace paths
  doctor                  Health check
  ping                    Liveness probe
  work <id>               Create or re-enter the task's worktree on branch tk/<id>
  review <id>             Open the task's review (diff view over the tk-derived changeset)
  changes <id>            Stat card for the task's changes (commits · +− · files) + changes-view link
  pr create <id>          Push the task's branch and open (or adopt) its one PR via gh (--title, --body)
  pr sync <id>            Pull the PR's state from gh into the record (explicit; never polled)
  pr close <id>           Close the task's PR via gh (branch and worktree kept; tk close prunes)
  pr merge <id>           Merge the task's PR via gh (--merge default | --squash | --rebase; then tk close <id>)
  pr <id>                 Show the recorded PR (local mirror; no gh call; also tk pr show <id>)
  worktree create <name>  Create a git worktree sharing this .tasks/ workspace
  worktree list           List worktrees and their tasks-workspace state
  worktree info           Show tasks-workspace state for the current worktree
  worktree remove <name>  Remove a worktree (with safety checks)
  worktree clean          Prune merged, clean worktrees of closed tasks (dry-run by default; --yes removes)
  hooks install [--tasks|--shared]  Install git hooks (markers preserve user content)
  hooks uninstall         Remove tk git hooks
  hooks list              Show hook install status
  hooks run <hook> [args] Execute a hook (called by installed shims)
  setup cursor|codex [--global] [--remove]  Install agent lifecycle hooks
  version                 Print version information
  update                  Self-update the binary (--latest for nightlies; tk update <id> updates an issue)
  quickstart              Quick start guide
  prime                   AI-optimized workflow context
  skill [path|install]    Print the tasks agent skill (LLM-facing docs: ops table, attachments/evidence/plans); path = location only, install copies it into a skills root — .agents/skills by default, --tool claude|omp|pi|codex picks that agent's root, --global for the user-wide copy; --force replaces an existing install; re-run after upgrading
  onboard [install|check|remove]  Managed tk block in AGENTS.md (--file <path> or --tool claude|gemini): install replaces the marked section (hash-checked), check exits 1 unless current, remove strips it; bare prints the block
  human                   Focused help menu for human users

GLOBAL FLAGS
  --json                  Output as JSON
  --markdown, --md        Output as markdown (issue lists separated by ---)
  --readonly              Reject writes
  -C, --directory <path>  Change directory before running (like git -C)
  --actor <name>          Override actor identity
  -h, --help              Show this help (tk help <cmd> or tk <cmd> -h shows that command)

EXAMPLES
  tk q "fix login bug"                 Quick-capture an idea
  tk create "Add logout" -t feature    Create feature
  tk create "epic: auth" -t epic        Create epic
  tk create "auth modal" -p 1 --parent <epic-id>  Create child task
  tk list --status=in_progress           WIP issues
  tk list --ready-to-review              Issues awaiting review
  tk ready                               What's unblocked
  tk show tk-abc                         Inspect issue
  tk update tk-abc --status in_progress   Start work
  tk comment tk-abc "halfway done"       Log progress
  tk close tk-abc --reason "pr merged"   Finish
  tk link tk-def tk-abc                   tk-def blocked by tk-abc
  tk search "permissions"                Find by text
  tk stale --days 7                      Stale issues
  tk tree                                Visualize epics and dependencies
  tk graph                               Full dependency tree
  tk epic tk-auth                         Epic progress

ENVIRONMENT
  NO_COLOR                Disable colored output
  TK_WEB_PORT             Port for tk web when --port is absent (beats config webPort; default 21579)
  TK_SESSION              Agent session id (tk finish); also names the default tk watch subscriber
`;
/** Fuller usage for commands whose one-line HELP entry omits real flags (`tk <cmd> -h`). */
const CREATE_USAGE = `  create <title> [opts]   Create issue
    -t/--type <type>, -p/--priority <0-4>, --status <s>, --due <date>, --defer-until <date>
    --description <d> (--stdin reads it), --labels a,b, --deps kind:id,... (default kind: blocks)
    --parent <id>, --assignee <u>, --owner <u>, --estimate <n>, --branch <b>
    --acceptance <text>, --design <text>, --notes <text>, --spec-id <id>, --external-ref <ref>
    --metadata <json>, --attach <path>... (--attach-metadata k=v,k2=v2), --plan <path>`;

const COMMAND_USAGE_OVERRIDES: Readonly<Record<string, string>> = {
  create: CREATE_USAGE,
  q: `  q <title> [opts]        Quick capture: create and print only the ID${CREATE_USAGE.slice(CREATE_USAGE.indexOf("\n"))}`,
  update: `  update <id> [flags]     Update fields
    --title <t> --description <d> (--body <d>/--stdin), --priority <0-4>, --type <t>
    --status <s>, --due <date>, --claim (start work), --assignee <u>, --owner <u>, --branch <b>
    --acceptance <text>, --design <text>, --append-notes <text>
    --parent <id>, --estimate <n>, --spec-id <id>, --external-ref <ref>
    --label a,b, --add-label a,b, --remove-label a,b
    --metadata <json>, --set-metadata k=v, --unset-metadata k
    --attach <path>... (--attach-metadata k=v,k2=v2), --plan <path>, --detach <ref>`,
  attach: `  attach <id> <path>...   Attach file paths (--attach-metadata k=v,k2=v2)
    --evidence <path>...    Ingest file contents as blobs (slug identity replaces in place)`,
  list: `  list [filters]          List issues
    --status <s> --parent <id> --assignee <u> --type <t> --priority <0-4> --label <l>
    --sprint <scope>, --limit <n>, --archived
    Shorthands: --open --closed --all --ready-to-review --approved --rejected`,
  ready: `  ready [--claim]         List ready (unblocked) issues; accepts list filters
    --claim                 Claim the first ready issue (status -> in_progress)`,
};

/** `tk <cmd> -h` / `tk help <cmd>`: the command's lines from HELP plus global flags. */
const commandHelp = (topic: string): string | null => {
  const lines = HELP.split("\n");
  const pattern = new RegExp(`^  ${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`);
  const matched: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!pattern.test(lines[index]!)) continue;
    matched.push(lines[index]!);
    while (index + 1 < lines.length && /^ {10,}\S/.test(lines[index + 1]!)) { index += 1; matched.push(lines[index]!); }
  }
  const usage = COMMAND_USAGE_OVERRIDES[topic] ?? matched.join("\n");
  if (usage === "") return null;
  const section = (name: string): string => { const start = lines.indexOf(name); if (start === -1) return ""; let end = start + 1; while (end < lines.length && lines[end] !== "") end += 1; return lines.slice(start, end).join("\n"); };
  return `tk ${topic}\n\n${usage}\n\n${section("GLOBAL FLAGS")}\n\n${section("ENVIRONMENT")}\n`;
};
/**
 * `tk watch` — reads the event wire (`.tasks/events.jsonl`). With `--until`,
 * `--drain` or `--follow` it runs the spec §10 loop modes from a
 * per-subscriber cursor in `.tasks/cursors.json` (see `runWatchMode`): exit 0
 * on match / drained / follow ended, 124 on `--until` timeout, 1 on a bad
 * query or unknown id. With none of them it is the frame-mode child: NDJSON
 * `ready`/`event`/`error` frames, exit 0 on stdin EOF, 3 after repeated
 * backend errors (the pi/omp extension spawns the same loop).
 */
/**
 * `tk tui [workspace]` — launch the terminal UI over the resolved workspace
 * (positional overrides discovery). Spawned as a child process so the
 * alternate-screen renderer owns its terminal state end to end.
 */
async function runTui(args: ParsedArgs, root: string | null, start: string): Promise<void> {
  // A `tk://…` positional is the boot deep link; workspace is the other one.
  const link = args.positionals.find((value) => value.startsWith("tk://")) ?? null;
  const positional = args.positionals.filter((value) => !value.startsWith("tk://"));
  const workspace = positional[1] ?? root;
  if (workspace === null) fail(await beadsHint(start));
  const entry = join(import.meta.dir, "..", "..", "tui", "src", "main.tsx");
  const childArgs = link === null ? ["bun", entry, workspace!] : ["bun", entry, workspace!, link];
  const child = Bun.spawn(childArgs, { cwd: workspace!, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  exit(await child.exited);
}

/**
 * `tk web [workspace|stop|port] [-d|--daemon] [--dev] [--open] [--port N]` —
 * serve the web UI over the resolved workspace. There is exactly one shared
 * web interface: when a live instance already answers the requested port, it
 * is repointed at this workspace over HTTP (`POST /api/open`) instead of
 * starting a rival server; only when nothing answers does the CLI bootstrap
 * the tkd daemon to host one. The daemon keeps serving until it idles out or
 * `tk web stop` / `tkd stop` shuts it down. `--dev` keeps the foreground
 * child (live reload owns the terminal, Ctrl-C stops it); `-d/--daemon` is an
 * accepted alias from the child-process era. `stop` shuts the live instance
 * down over HTTP and prunes a stale registry row; `port` prints the live
 * instance URL. `--open` launches the browser. The port is `--port`, else
 * `TK_WEB_PORT`, else the workspace config's `webPort`, else the shared
 * default (21579).
 */
async function runWeb(args: ParsedArgs, root: string | null, start: string): Promise<void> {
  const sub = args.positionals[1];
  const readWebConfig = async (tasksDir: string) =>
    readWorkspaceConfig(tasksDir).catch((error: unknown) => {
      process.stderr.write(`tk web: ignoring invalid config.json (${error instanceof Error ? error.message.split("\n")[0]! : "unreadable"})\n`);
      return null;
    });
  if (sub === "stop" || sub === "port") {
    if (root === null) fail(await beadsHint(start));
    const tasksDir = join(root!, ".tasks");
    const row = (await readRuntimeRegistry(tasksDir)).find((entry) => entry.kind === "web") ?? null;
    const webConfig = await readWebConfig(tasksDir);
    const { port: requested } = resolveWebPort(stringFlag(args, "port"), process.env["TK_WEB_PORT"], webConfig?.webPort);
    // One shared web interface: the registry row is only a hint (the instance
    // it named may since have been repointed at another workspace), so the row
    // URL is probed first and the shared port falls back — a live HTTP answer
    // is the only proof. The instance is stopped or reported regardless of
    // which workspace it currently serves.
    const status = (row !== null && row.kind === "web" ? await probeWebServer(row.url) : null) ?? await probeWebServer(`http://localhost:${requested}`);
    if (status === null) {
      if (row !== null) await unregisterRuntime(tasksDir, row.id);
      process.stdout.write(`tk web: no server running for ${root}\n`);
      exit(sub === "stop" ? 0 : 1);
    }
    if (sub === "port") { process.stdout.write(`${status!.url}\n`); exit(0); }
    const stopped = await fetch(`${status!.url}/api/stop`, { method: "POST" }).catch(() => null);
    if (stopped === null || !stopped.ok) fail(`tk web: could not stop ${status!.url} (pid ${status!.pid})`);
    process.stdout.write(`${green("✓")} stopped ${status!.url} (pid ${status!.pid})\n`);
    exit(0);
  }
  const workspace = sub ?? root;
  if (workspace === null) fail(await beadsHint(start));
  const dev = booleanFlag(args, "dev");
  const open = booleanFlag(args, "open");
  const daemon = booleanFlag(args, "daemon");
  const port = stringFlag(args, "port");
  if (dev) {
    // Dev mode keeps the foreground child: the live-reload server owns the
    // terminal and its lifetime is the CLI lifetime.
    const entry = join(import.meta.dir, "..", "..", "web", "src", "main.ts");
    const child = Bun.spawn(["bun", entry, workspace!, "--dev", ...(open ? ["--open"] : []), ...(port !== undefined ? ["--port", port] : []), ...(daemon ? ["--daemon"] : [])], { cwd: workspace!, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    exit(await child.exited);
  }
  // Default: one shared web interface. A live instance answering the port is
  // repointed at this workspace (it may already serve a different one);
  // otherwise the daemon bootstraps and hosts a fresh server.
  const dir = await rootFrom(workspace!);
  if (dir === null) fail(await beadsHint(workspace!));
  const webConfig = await readWebConfig(join(dir!, ".tasks"));
  const { port: resolvedPort } = resolveWebPort(port, process.env["TK_WEB_PORT"], webConfig?.webPort);

  const tasksDir = join(dir!, ".tasks");
  const row = (await readRuntimeRegistry(tasksDir)).find((entry) => entry.kind === "web") ?? null;
  const live = (row !== null ? await probeWebServer(row.url) : null) ?? await probeWebServer(`http://localhost:${resolvedPort ?? WEB_DEFAULT_PORT}`);
  if (live !== null) {
    // Replace, never rival: repoint the running instance at this workspace.
    const response = await fetch(`${live.url}/api/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: dir }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (response === null || !response.ok) {
      const reason = response === null ? "unreachable" : `rejected (${response.status})`;
      fail(`tk web: ${live.url} is serving ${live.workspace} and could not be repointed (${reason})`);
    }
    // Inline macOS browser open: the CLI talks to the web server only over
    // HTTP, so @tasks/web's launchBrowser is not imported here.
    if (open) { try { Bun.spawn(["open", live.url], { stdout: "ignore", stderr: "ignore" }); } catch { /* non-macOS */ } }
    process.stdout.write(`tk web → ${live.url}  (now serving ${dir}, was ${live.workspace})\n`);
    exit(0);
  }

  const client = await connectOrSpawn(dir!).catch((error: unknown) => fail(`tk web: daemon unavailable (${error instanceof Error ? error.message : String(error)})`));
  try {
    const served = await client.call("web.start", {
      root: dir,
      ...(resolvedPort !== undefined ? { port: resolvedPort } : {}),
      ...(open ? { open: true } : {}),
    }) as { readonly url: string; readonly port: number; readonly pid: number };
    process.stdout.write(`tk web → ${served.url}  (daemon pid ${served.pid})\n`);
  } catch (error) {
    fail(`tk web: ${error instanceof RpcCallError ? error.wireError.message : error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Drop the socket; the daemon (and the web server it hosts) stays up.
    client.close();
  }
  exit(0);
}
/**
 * `tk daemon [start|status|stop|restart]` — manage the global tkd daemon.
 * Every command connects to the running daemon (`connectDaemon`, never spawns)
 * or reports it absent; only `start`/`restart` bring one into existence via the
 * same `connectOrSpawn` bootstrap `tk web` uses. Status gathers `daemon.ping`
 * plus `web.status`, so one command shows the whole daemon story. Global —
 * no workspace resolution required.
 */
async function runDaemon(args: ParsedArgs, start: string): Promise<void> {
  const sub = args.positionals[1];
  if (sub !== undefined && sub !== "start" && sub !== "status" && sub !== "stop" && sub !== "restart") {
    fail("usage: tk daemon [start|status|stop|restart] [--json] [--idle-ms N]  (status also accepts --quiet)");
  }
  const json = booleanFlag(args, "json");
  const quiet = booleanFlag(args, "quiet");

  const idleRaw = stringFlag(args, "idle-ms");
  if (idleRaw !== undefined && !/^\d+$/.test(idleRaw)) fail("tk daemon: --idle-ms must be a non-negative integer");
  const idleMs = idleRaw === undefined ? undefined : Number(idleRaw);

  // One snapshot: daemon status + hosted web, or null when not running (raced
  // shutdown included). Every command goes through here or probes first — none
  // of the management paths ever spawns a daemon.
  const describe = async (): Promise<{ readonly daemon: DaemonStatus; readonly web: { readonly url: string; readonly port: number; readonly root?: string } | null } | null> => {
    const client = await connectDaemon();
    if (client === null) return null;
    try {
      const daemon = await client.call("daemon.ping") as DaemonStatus;
      let web: { readonly url: string; readonly port: number; readonly root?: string } | null = null;
      try {
        const webStatus = await client.call("web.status") as { readonly hosting: boolean; readonly url?: string; readonly port?: number; readonly root?: string };
        if (webStatus.hosting) web = { url: webStatus.url!, port: webStatus.port!, ...(webStatus.root === undefined ? {} : { root: webStatus.root }) };
      } catch { /* web host torn down between ping and status: not hosting */ }
      return { daemon, web };
    } finally {
      client.close();
    }
  };

  if (sub === "status" || sub === undefined) {
    const snapshot = await describe();
    if (snapshot === null) {
      if (json) output({ running: false, root: start, socketPath: daemonSocketPath() }, true);
      else if (quiet) exit(1);
      else process.stdout.write(`${dim("Daemon is not running.")} Start one: ${cyan("tk daemon start")}\n`);
      return;
    }
    const { daemon, web } = snapshot;
    if (json) {
      output({
        running: true,
        root: start,
        roots: daemon.roots,
        socket_path: daemon.socketPath,
        pid: daemon.pid,
        // The probe holds exactly one connection while sampling the ping; report
        // only other attached clients (transient probe socket is not interesting).
        connections: Math.max(0, daemon.connections - 1),
        event_subscriptions: daemon.eventSubscriptions,
        idle_ms: daemon.idleMs,
        uptime_ms: daemon.uptimeMs,
        uptime: duration(daemon.uptimeMs / 1000),
        web: web === null ? { hosting: false } : { hosting: true, url: web.url, port: web.port, ...(web.root === undefined ? {} : { root: web.root }) },
      }, true);
      return;
    }
    if (quiet) exit(0);
    const lines = [
      `${green("●")} daemon  ${cyan(`pid ${daemon.pid}`)}  ${dim(`up ${duration(daemon.uptimeMs / 1000)} · socket ${daemon.socketPath}`)}`,
      daemon.roots.length === 0
        ? `  ${dim("workspaces")} ${dim("none open yet")}`
        : `  ${dim("workspaces")} ${daemon.roots.join(", ")}`,
      `  ${dim("connections")} ${Math.max(0, daemon.connections - 1)}  ${dim("event subscriptions")} ${daemon.eventSubscriptions}  ${dim("idle exit")} ${daemon.idleMs === 0 ? "disabled" : `${duration(daemon.idleMs / 1000)} idle`}`,
      web === null
        ? `  ${dim("web")} ${dim("not hosted (tk web starts it)")}`
        : `  ${dim("web")} ${cyan(web.url)} ${dim(`(port ${web.port}${web.root === undefined ? "" : `, ${web.root}`})`)}`,
    ];
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  if (sub === "start") {
    const already = await probeDaemon(1000);
    if (already !== null) {
      if (json) output({ started: false, alreadyRunning: true, pid: already.pid }, true);
      else process.stdout.write(`daemon already running (pid ${already.pid})\n`);
      return;
    }
    const client = await connectOrSpawn(start, { ...(idleMs !== undefined ? { idleMs } : {}) }).catch((error: unknown) => fail(`tk daemon: ${error instanceof Error ? error.message : String(error)}`));
    try {
      const ping = await client.call("daemon.ping") as DaemonStatus;
      if (json) output({ started: true, alreadyRunning: false, pid: ping.pid, socket_path: ping.socketPath, idle_ms: ping.idleMs }, true);
      else process.stdout.write(`${green("✓ daemon started")} ${dim(`pid ${ping.pid} · socket ${ping.socketPath}${idleMs === 0 ? " · idle exit disabled" : ""}`)}\n`);
    } finally {
      // The connection itself pins the daemon out of idle exit; drop it and let
      // the daemon live its normal life.
      client.close();
    }
    return;
  }

  if (sub === "stop") {
    const running = await probeDaemon(1000);
    if (running === null) {
      await cleanStaleSocket(daemonSocketPath()).catch(() => {});
      if (json) output({ stopped: false, running: false }, true);
      else process.stdout.write(`${dim("daemon not running")}\n`);
      return;
    }
    const client = await connectDaemon();
    if (client === null) fail("tk daemon: daemon vanished between probe and connect — retry");
    try {
      await client!.call("daemon.stop");
    } catch (error) {
      // The stop ack usually lands before teardown; a transport drop here is success.
      if (!(error instanceof RpcCallError)) throw error;
    } finally {
      client!.close();
    }
    if (json) output({ stopped: true, running: false, pid: running.pid }, true);
    else process.stdout.write(`${green("✓ daemon stopped")} ${dim(`pid ${running.pid}`)}\n`);
    return;
  }

  // restart: stop the live daemon first — connectOrSpawn would happily reconnect
  // to the old process, turning "restart" into a no-op ping.
  const before = await probeDaemon(1000);
  if (before !== null) {
    const stopClient = await connectDaemon();
    if (stopClient !== null) {
      try {
        await stopClient.call("daemon.stop");
      } catch (error) {
        // The stop ack usually lands before teardown; a transport drop here is success.
        if (!(error instanceof RpcCallError)) throw error;
      } finally {
        stopClient.close();
      }
      // The old socket must be gone before the new spawn, or connectOrSpawn
      // races the dying daemon's listener.
      const deadline = Date.now() + 3000;
      while (await socketAlive(daemonSocketPath(), 200)) {
        if (Date.now() >= deadline) fail("tk daemon: old daemon socket did not close within 3s");
        await Bun.sleep(50);
      }
    }
  }
  const client = await connectOrSpawn(start, { ...(idleMs !== undefined ? { idleMs } : {}) }).catch((error: unknown) => fail(`tk daemon: ${error instanceof Error ? error.message : String(error)}`));
  try {
    const ping = await client.call("daemon.ping") as DaemonStatus;
    if (json) output({ restarted: true, stoppedPid: before?.pid ?? null, pid: ping.pid, socket_path: ping.socketPath, idle_ms: ping.idleMs }, true);
    else process.stdout.write(`${green("✓ daemon restarted")} ${dim(`${before !== null ? `was pid ${before.pid}, ` : ""}now pid ${ping.pid} · socket ${ping.socketPath}`)}\n`);
  } finally {
    client.close();
  }
}
async function runWatch(args: ParsedArgs, start: string): Promise<void> {
  const root = await rootFrom(start);
  if (root === null) fail(await beadsHint(start));
  const surface = await import("@tasks/surface");
  const ids = args.positionals.slice(1);
  const modes = (["until", "drain", "follow"] as const).filter((mode) => args.flags.get(mode) !== undefined);
  if (modes.length > 1) fail("choose one of --until, --drain, --follow");
  const store = await surface.openSurfaceStore(root!, { readonly: true });
  try {
    if (modes.length === 0) {
      // Frame mode (pi/omp child protocol): NDJSON ready/event/error frames.
      const argv: string[] = [];
      const kinds = stringFlag(args, "kinds"); if (kinds !== undefined) argv.push("--kinds", kinds);
      const mergedIds = [...(stringFlag(args, "ids")?.split(",").filter(Boolean) ?? []), ...ids]; if (mergedIds.length > 0) argv.push("--ids", mergedIds.join(","));
      const label = stringFlag(args, "label"); if (label !== undefined) argv.push("--label", label);
      const interval = stringFlag(args, "interval"); if (interval !== undefined) argv.push("--interval", interval);
      const after = stringFlag(args, "after"); if (after !== undefined) argv.push("--after", after);
      await surface.runWatchChild(store, surface.parseWatchArgs(argv));
      return;
    }
    await runWatchMode(args, store, surface, modes[0]!, ids);
  } finally {
    await store.close();
  }
}

/**
 * WIRE-03 pickup race: after `tk finish <id> --session <sid>`, seed cursor
 * `session:<sid>` at the finish's own `task.status` line (only when absent),
 * so a review or comment landing before the agent's first `tk watch` is still
 * past its cursor. Best-effort: never fails the finish.
 */
async function seedFinishCursor(tasksDir: string, session: string, id: string): Promise<void> {
  if (session.trim() === "") return;
  try {
    const { lastEventSeq, readEvents, seedCursor } = await import("@tasks/surface");
    const end = await lastEventSeq(tasksDir);
    const lines = await readEvents(tasksDir, { after: Math.max(0, end - 50) });
    const finish = lines.filter((line) => line.task === id && line.type === "task.status").at(-1);
    if (finish !== undefined) await seedCursor(tasksDir, `session:${session.trim()}`, finish.seq);
  } catch { /* advisory */ }
}

/**
 * `tk watch [<id>…] --until "<query>" | --drain | --follow "<query>"` — the
 * spec §10 loop modes over `.tasks/events.jsonl` with a per-subscriber cursor
 * (`--as` › `session:<TK_SESSION>` › `cli:<actor>`). Exit 0 on match / drained /
 * follow ended (SIGINT, SIGTERM, closed stdin pipe); 124 on `--until` timeout.
 */
async function runWatchMode(args: ParsedArgs, store: import("@tasks/surface").SurfaceStore, surface: typeof import("@tasks/surface"), mode: "until" | "drain" | "follow", ids: readonly string[]): Promise<void> {
  const json = booleanFlag(args, "json");
  for (const id of ids) {
    const found = await store.transact(async (uow) => { const result = await uow.findById(id as Issue["id"]); return result.ok ? result.value : null; });
    if (!found.ok || found.value === null) fail(`issue not found: ${id}`);
  }
  const text = mode === "drain" ? "" : (stringFlag(args, mode) ?? "");
  const query = surface.withTasks(surface.parseEventQuery(text), ids);
  const fromText = stringFlag(args, "from");
  const from = fromText === undefined ? undefined : Number(fromText);
  if (from !== undefined && (!Number.isInteger(from) || from < 0)) fail(`invalid --from: ${fromText}`);
  const options = {
    query,
    subscriber: stringFlag(args, "as") ?? surface.defaultSubscriber(process.env, store.actor),
    ...(from !== undefined ? { from } : {}),
    peek: booleanFlag(args, "peek"),
  };
  const print = (event: import("@tasks/surface").TaskEvent): void => { process.stdout.write(`${json ? JSON.stringify(event) : surface.formatEventLine(event)}\n`); };
  if (mode === "until") {
    const timeoutText = stringFlag(args, "timeout") ?? "30m";
    const timeoutMs = surface.parseDuration(timeoutText);
    const event = await surface.waitUntil(store, { ...options, timeoutMs });
    if (event === null) { process.stderr.write(`no matching event within ${timeoutText}\n`); process.exitCode = 124; return; }
    print(event);
    return;
  }
  if (mode === "drain") { for (const event of await surface.drainEvents(store, options)) print(event); return; }
  const handle = surface.followEvents(store, { ...options, onEvent: print });
  const stop = (): void => handle.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // A harness that closes the pipe ends the follow (runWatchChild's EOF rule); a TTY or /dev/null stdin does not.
  let stdinPipe = false;
  try { const info = fstatSync(0); stdinPipe = info.isFIFO() || info.isSocket(); } catch { /* no stdin */ }
  if (stdinPipe) void (async () => { try { for await (const _ of process.stdin) { /* discard */ } } catch { /* destroyed on exit */ } stop(); })();
  await handle.done;
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  process.exitCode = 0;
  if (stdinPipe) process.stdin.destroy();
}


/**
 * `tk hooks` — git hooks lifecycle, ported from bd hooks:
 * install [--tasks|--shared], uninstall, list [--json], run <hook> [args].
 * Dispatched before workspace resolution so hooks work in any git repo.
 */
async function runHooks(args: ParsedArgs, start: string, json: boolean): Promise<void> {
  const sub = args.positionals[1];
  if (sub === "install") {
    const shared = booleanFlag(args, "shared");
    const tasks = booleanFlag(args, "tasks");
    const { hooksDir } = await installHooks(start, { shared, tasks });
    if (json) output({ success: true, message: "Git hooks installed successfully", shared, tasks }, true);
    else {
      console.log("✓ Git hooks installed successfully");
      if (tasks) console.log(`Hooks installed to: ${join(hooksDir)}\nGit config set: core.hooksPath=${hooksDir}`);
      else if (shared) console.log(`Hooks installed to: ${hooksDir}\nGit config set: core.hooksPath=${hooksDir}\n⚠️  Remember to commit .tasks-hooks/ to share with your team!`);
      console.log(`\nInstalled hooks:\n${managedHookNames.map((name) => `  - ${name}`).join("\n")}`);
    }
    return;
  }
  if (sub === "uninstall") {
    await uninstallHooks(start);
    if (json) output({ success: true, message: "Git hooks uninstalled successfully" }, true);
    else console.log("✓ Git hooks uninstalled successfully");
    return;
  }
  if (sub === "list") {
    const statuses = await checkGitHooks(start);
    if (json) { output({ hooks: statuses }, true); return; }
    console.log("Git hooks status:");
    for (const status of statuses) {
      if (!status.installed) console.log(`  ✗ ${status.name}: not installed`);
      else if (status.isShim) console.log(`  ✓ ${status.name}: installed (shim ${status.version})`);
      else if (status.outdated) console.log(`  ⚠ ${status.name}: installed (version ${status.version}, current: ${VERSION}) - outdated`);
      else console.log(`  ✓ ${status.name}: installed (version ${status.version})`);
    }
    return;
  }
  if (sub === "run") {
    const hookName = args.positionals[2] ?? fail("hooks run requires hook name");
    const exitCode = await runHookCommand(hookName, args.positionals.slice(3), start);
    if (exitCode !== 0) exit(exitCode);
    return;
  }
  fail("usage: tk hooks install [--tasks|--shared] | uninstall | list | run <hook> [args]");
}

async function main(): Promise<void> { const rawTokens = process.argv.slice(2); // `-d` after the `web` token is daemon mode, not the global description alias (covers `tk web -d` and `tk -C ws web -d`)
  const webIdx = rawTokens.indexOf("web"); const args = parseArgs(webIdx === -1 ? rawTokens : rawTokens.map((token, index) => index > webIdx && token === "-d" && rawTokens[index - 1] !== "-d" && rawTokens[index - 1] !== "--description" ? "--daemon" : token)); const command = args.positionals[0] ?? "help"; const json = booleanFlag(args, "json"); const markdown = !json && (booleanFlag(args, "markdown") || booleanFlag(args, "md")); const start = directory(args, cwd()); let root = await rootFrom(start);
  if (command === "init" && (booleanFlag(args, "help") || booleanFlag(args, "h"))) { process.stdout.write(INIT_HELP); return; }
  if (command === "help" && args.positionals[1] === "init") { process.stdout.write(INIT_HELP); return; }
  if (command === "switch-backend" && (booleanFlag(args, "help") || booleanFlag(args, "h"))) { process.stdout.write(SWITCH_BACKEND_HELP); return; }
  if (command === "help" && args.positionals[1] === "switch-backend") { process.stdout.write(SWITCH_BACKEND_HELP); return; }
  if (command === "update" && args.positionals.length === 1 && (booleanFlag(args, "help") || booleanFlag(args, "h"))) { process.stdout.write(UPDATER_HELP); return; }
  const topic = command === "help" ? args.positionals[1] : command;
  if (command === "help" || booleanFlag(args, "help") || booleanFlag(args, "h")) { process.stdout.write(topic === undefined ? HELP : commandHelp(topic) ?? HELP); return; }
  if (command === "tui") { await runTui(args, root, start); return; }
  if (command === "web") { await runWeb(args, root, start); return; }
  if (command === "daemon") { await runDaemon(args, start); return; }
  if (command === "watch") { await runWatch(args, start); return; }
/**
 * `tk setup cursor|codex [--global] [--remove]` — agent lifecycle hooks.json
 * management (hooks only; rules/skill templates are agent-specific and are
 * not part of the hooks port). tk owns only its own command entries.
 */
async function runAgentHooksSetup(args: ParsedArgs, start: string, json: boolean): Promise<void> {
  const agent = args.positionals[1] ?? fail("usage: tk setup cursor|codex [--global] [--remove]");
  const global = booleanFlag(args, "global");
  const remove = booleanFlag(args, "remove");
  if (agent === "cursor") {
    const path = cursorHooksTargetPath(global, start);
    if (remove) { await removeCursorHooks(path); if (json) output({ success: true, agent, removed: true }, true); else console.log("✓ Removed tk Cursor hooks"); return; }
    await installCursorHooks(path);
    if (json) output({ success: true, agent, path, events: ["sessionStart", "preCompact", "postToolUse"] }, true);
    else console.log(`✓ Cursor hooks installed: ${path} (sessionStart, preCompact, postToolUse)\nThe hooks invoke 'tk cursor-hook', so make sure tk is on PATH for Cursor.`);
    return;
  }
  if (agent === "codex") {
    if (remove) { await removeCodexHooks(global, start); if (json) output({ success: true, agent, removed: true }, true); else console.log("✓ Removed tk Codex hooks"); return; }
    await installCodexHooks(global, start);
    if (json) output({ success: true, agent, path: codexHooksPath(global, start), events: CODEX_EVENTS }, true);
    return;
  }
  fail(`unsupported setup target: ${agent} (supported: cursor, codex)`);
}

  if (command === "init") { if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes"); const initRoot = start; root = initRoot; const prefix = stringFlag(args, "prefix") ?? "tk"; const storageConfig = initStorageConfig(args); await mkdir(join(initRoot, ".tasks"), { recursive: true }); const initConfig: Config = { prefix, storage: storageConfig }; await writeWorkspaceConfig(join(initRoot, ".tasks"), initConfig); const storage = await openStorage(join(initRoot, ".tasks"), initConfig.storage ?? DEFAULT_STORAGE); try { unwrap(await storage.adapter.migrate()); } finally { await storage.close(); } if (json) output({ workspace: initRoot, prefix, backend: storage.backend, initialized: true }, true); else console.log(`${green("✓ Initialized")} tasks workspace at ${join(initRoot, ".tasks")}`); return; }
  // Hook commands work without a .tasks workspace (install/run must work in
  // any git repo, like bd hooks). Dispatch before workspace resolution.
  if (command === "hooks") { await runHooks(args, start, json); return; }
  if (command === "setup") { await runAgentHooksSetup(args, start, json); return; }
  if (command === "skill") { const result = await runSkill(args, import.meta.dir, root); if (json) output({ path: result.path, skill: result.skill, target: result.target, scope: result.scope }, true); else if (markdown) process.stdout.write(formatMarkdown(result, false)); else console.log(result.text); return; }
  // Onboard writes agent instruction files (AGENTS.md by default), not the
  // .tasks workspace — dispatch before workspace resolution.
  if (command === "onboard") { await runOnboard(args, start, json, import.meta.dir); return; }
  // Bare `tk update` (no issue id) self-updates the binary; it must dispatch
  // before workspace resolution so it works outside any .tasks/ workspace.
  if (command === "update" && args.positionals.length === 1) { await runSelfUpdate(args, json); return; }
  if (command === "codex-hook") { await runCodexHook(args.positionals[1] ?? fail("codex-hook requires event"), await readInput()); return; }
  if (command === "cursor-hook") { await runCursorHook(args.positionals[1] ?? fail("cursor-hook requires event"), await readInput()); return; }
  // Worktree commands need git, not a .tasks workspace (`tk worktree info` must
  // report "none" state in a workspaceless repo). Dispatch before workspace
  // resolution; create/remove gate readonly themselves.
  if (command === "worktree") { await runWorktree(args, start, json); return; }
  // migrate bootstraps its own workspace so a beads-only checkout needs no separate init,
  // except under --dry-run, which must leave the filesystem untouched.
  const bootstrapping = root === null && command === "migrate";
  const ephemeral = bootstrapping && booleanFlag(args, "dry-run");
  if (bootstrapping) { if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes"); if (!ephemeral) { await mkdir(join(start, ".tasks"), { recursive: true }); await writeWorkspaceConfig(join(start, ".tasks"), { prefix: stringFlag(args, "prefix") ?? "tk", storage: DEFAULT_STORAGE }); } root = start; }
  if (root === null) {
    // Git hook context: exit silently when no workspace found (don't interrupt commits)
    if (process.env["TK_GIT_HOOK"] ?? process.env["BD_GIT_HOOK"]) exit(0);
    fail(await beadsHint(start));
  }
  const workspace = root!; const tasksDir = join(workspace, '.tasks');
  const config = await readWorkspaceConfig(tasksDir); if (booleanFlag(args, "readonly") && writers.has(command)) fail("readonly mode blocks writes"); if (command === "where") { const preview = describeStorage(tasksDir, await resolveStorageConfig(tasksDir, config)); const info = { path: tasksDir, workspace, backend: preview.backend, storage: preview.location, database_path: preview.location, database: preview.location, prefix: config.prefix ?? "tk", schema_version: 1 }; if (json) output(info, true); else console.log(formatWhere(info)); return; }
  if (command === "switch-backend") {
    const targetConfig = switchBackendTarget(args);
    const currentResolved = await resolveStorageConfig(tasksDir, config);
    const currentPreview = describeStorage(tasksDir, currentResolved);
    const targetPreview = describeStorage(tasksDir, targetConfig);
    if (currentPreview.backend === targetPreview.backend && currentPreview.location === targetPreview.location) fail(`workspace is already using ${targetPreview.backend} at ${targetPreview.location}`);
    const dryRun = booleanFlag(args, "dry-run");
    const source = await openStorage(tasksDir, currentResolved);
    let issues: readonly Issue[];
    try { unwrap(await source.adapter.migrate()); issues = await transaction(source.adapter, async (uow) => unwrap(await uow.list({ limit: 100_000 })).items); } finally { await source.close(); }
    if (dryRun) {
      const report = { from: currentPreview.backend, to: targetPreview.backend, from_location: currentPreview.location, to_location: targetPreview.location, issues: issues.length, dry_run: true };
      if (json) output(report, true); else console.log(`Would move ${issues.length} issue(s) from ${currentPreview.backend} (${currentPreview.location}) to ${targetPreview.backend} (${targetPreview.location}). Dry run: nothing written.`);
      return;
    }
    const jsonl = issues.map((issue) => JSON.stringify(issueToBdWire({ version: 1, issue, unknown: issue.wireUnknown }, canonicalTimestampCodec))).join("\n");
    const target = await openStorage(tasksDir, targetConfig);
    try {
      unwrap(await target.adapter.migrate());
      const result = await migrateBeadsJsonl(target.adapter, jsonl, { onConflict: "overwrite", strict: true, timestamps: canonicalTimestampCodec });
      const summary = unwrap(result);
      await writeWorkspaceConfig(tasksDir, { ...config, storage: targetConfig });
      const report = { from: currentPreview.backend, to: target.backend, issues: summary.imported, old_location: currentPreview.location, new_location: target.location };
      if (json) output(report, true); else console.log(`${green("✓ Switched backend")} from ${currentPreview.backend} to ${target.backend}: moved ${summary.imported} issue(s). Old data still at ${currentPreview.location} — remove it once you've verified the new backend.`);
    } finally { await target.close(); }
    return;
  }
  const readonly = booleanFlag(args, "readonly");
  const storage = ephemeral ? await openEphemeralScratch() : await openStorage(tasksDir, await resolveStorageConfig(tasksDir, config), { readonly }); try { if (readonly) { if (unwrap(await storage.adapter.hasPendingMigrations())) fail("readonly mode requires current database; pending migrations detected"); } else unwrap(await storage.adapter.migrate()); const actor = stringFlag(args, "actor") ?? process.env["USER"] ?? "unknown"; /* Event wire (spec §10): every committed CLI write appends to .tasks/events.jsonl. Not the scratch store, not bulk copies (migrate/import). */ const database = ephemeral || command === "migrate" || command === "import" ? storage.adapter : withEventLog(storage.adapter, { tasksDir, actor, session: process.env["TK_SESSION"] || undefined }); const service = new CommandService(database, workspace, config, actor, storage.backend, storage.backend === "postgres" ? null : storage.location);
    // Every dispatch produces the JSON value plus an optional human formatter.
    let value: unknown; let human: (() => string) | null = null;
    // JSON stays byte-identical for agents; humans get colored, iconed output.
    if (command === "create") { const issue = await service.create(args); value = issueWire(issue); human = () => confirmation("Created issue", issue); }
    else if (command === "note") { const body = args.positionals.slice(2).join(" ") || fail("note requires text"); const issue = await service.note(args, body); value = issueWire(issue); human = () => confirmation("Note added to", issue); }
    else if (command === "attach") { const issue = await service.attach(args); value = issueWire(issue); human = () => confirmation("Attached file to", issue); }
    else if (command === "detach") { const issue = await service.detach(args); value = issueWire(issue); human = () => confirmation("Detached file from", issue); }
    else if (command === "q") { const id = await service.quick(args); value = { id }; human = () => id; }
    else if (command === "work") { const result = await service.work(args); value = result.value; human = result.human; }
    else if (command === "show") {
      const [issue, images] = await service.showWithImages(args);
      const wire = issueWire(issue);
      const doors = reviewDoors(issue.id, await webBase(root!));
      const changesetMeta = issue.metadata["changeset"];
      const recordedBase = changesetMeta !== null && typeof changesetMeta === "object" && !Array.isArray(changesetMeta) && typeof (changesetMeta as Record<string, unknown>)["base"] === "string" ? (changesetMeta as Record<string, unknown>)["base"] as string : null;
      // CHG-02: closed tasks render the frozen snapshot with NO git calls
      // (D-05 — the record survives branch deletion/decay); non-closed stays live.
      const frozen = issue.status === "closed" ? readChangesetSnapshot(issue.metadata) : null;
      const derived = frozen ?? (recordedBase !== null && issue.branch !== null ? await deriveChangeset({ cwd: workspace }, recordedBase, issue.branch) : null);
      if (derived !== null) wire["changeset"] = { base: frozen !== null ? frozen.base : recordedBase, commits: derived.commits, files: derived.files, counts: derived.counts };
      // PR-03: branch out of reach and nothing frozen → the finish report cache, counts only (no files[]), marked stale.
      const reportView = derived === null && readReportStat(issue.metadata) !== null ? await resolveChanges({ cwd: workspace }, issue, await webBase(root!)) : null;
      if (reportView !== null && reportView.source === "report") wire["changeset"] = { source: "report", stale: true, counts: { additions: reportView.stat.additions, deletions: reportView.stat.deletions }, commits: reportView.stat.commits, files: reportView.stat.files };
      wire["review_doors"] = doors;
      wire["review"] = reviewComments(issue);
      value = [wire];
      human = () => formatShow(issue, images, derived, doors, reportView !== null && reportView.source === "report" ? reportView : null);
    }
    else if (command === "changes") {
      const issue = await service.show(args);
      const view = await resolveChanges({ cwd: workspace }, issue, await webBase(root!));
      value = { id: issue.id, changes: changesWire(view) };
      human = () => formatChanges(view, readPrRecord(issue.metadata));
    }
    else if (command === "pr") {
      const outcome = await service.pr(args, await webBase(root!));
      value = outcome.op === "show" ? { id: outcome.id, pr: outcome.pr } : { id: outcome.id, op: outcome.op, pr: outcome.pr };
      human = () => formatPr(outcome.op, outcome.id, outcome.pr);
    }
    else if (command === "review") { const issue = await service.show(args); await runTui({ ...args, positionals: ["tui", `tk://diff/${issue.id}`] }, root, start); return; }
    else if (command === "list" || command === "ready") { const issues = await service.list(args, command === "ready"); value = issues.map(issueWire); const base = await webBase(root!); human = () => (command === "ready" ? formatReady(issues, base) : formatList(issues, base)); }
    else if (command === "blocked") { const all = await service.all(); const blocked = all.filter((issue) => issue.dependencies.some((edge) => edge.type === "blocks" && all.some((other) => other.id === edge.target && other.status !== "closed"))); value = blocked.map(issueWire); const base = await webBase(root!); human = () => formatBlocked(blocked, all, base); }
    else if (command === "count") { const all = await service.all(); value = { total: all.length, by_status: Object.fromEntries([...new Set(all.map((issue) => issue.status))].sort().map((status) => [status, all.filter((issue) => issue.status === status).length])), by_type: Object.fromEntries([...new Set(all.map((issue) => issue.type))].sort().map((type) => [type, all.filter((issue) => issue.type === type).length])) }; human = () => formatCount(value as { total: number; by_status: Record<string, number>; by_type: Record<string, number> }); }
    else if (command === "status") { const all = await service.all(); value = Object.fromEntries([...new Set(all.map((issue) => issue.status))].sort().map((status) => [status, all.filter((issue) => issue.status === status).length])); human = () => formatStatus(value as Record<string, number>); }
    else if (command === "stats") { const all = await service.all(); const now = new Date(); const blockedIds = new Set(all.filter((issue) => issue.dependencies.some((edge) => edge.type === "blocks" && all.some((other) => other.id === edge.target && other.status !== "closed"))).map((issue) => issue.id)); const tally = (status: string) => all.filter((issue) => issue.status === status).length; value = { total: all.length, open: tally("open"), in_progress: tally("in_progress"), ready_to_review: tally("ready-to-review"), approved: tally("approved"), rejected: tally("rejected"), blocked: blockedIds.size, closed: tally("closed"), deferred: tally("deferred"), archived: tally("archived"), ready: all.filter((issue) => issue.status === "open" && !blockedIds.has(issue.id) && (issue.deferUntil === null || issue.deferUntil <= now)).length }; human = () => formatStats(value as { total: number; open: number; in_progress: number; ready_to_review: number; approved: number; rejected: number; blocked: number; closed: number; deferred: number; archived: number; ready: number }); }
    else if (command === "query") { const expression = args.positionals.slice(1).join(" ") || fail("query requires expression"); const issues = queryIssues(await service.all(), expression); value = issues.map(issueWire); const base = await webBase(root!); human = () => formatList(issues, base); }
    else if (command === "search") { const text = args.positionals.slice(1).join(" ").trim() || fail("search requires text"); const needle = text.toLowerCase(); const issues = (await service.all()).filter((issue) => [issue.id, issue.title, issue.description, issue.notes ?? "", ...issue.labels].join("\n").toLowerCase().includes(needle)); value = issues.map(issueWire); const base = await webBase(root!); human = () => formatSearch(issues, text, base); }
    else if (command === "import") { const counts = await service.importJsonl(await readInput()); value = { imported: counts.imported, sprints: counts.sprints }; human = () => green(`✓ Imported ${counts.imported} issue(s)` + (counts.sprints > 0 ? ` and ${counts.sprints} sprint(s)` : "")); }
    else if (command === "history") { const entries = await service.history(args); value = entries; human = () => formatHistory(entries, args.positionals[1] ?? "current"); }
    else if (command === "types") { const used = [...new Set((await service.all()).map((issue) => issue.type))].sort(); value = used; human = () => formatTypes(used); }
    else if (command === "statuses") { const used = [...new Set([...KNOWN_STATUSES, ...(await service.all()).map((issue) => issue.status)])].sort(); value = used; human = () => formatStatuses(used); }
    else if (command === "export") value = await service.exportWire();
    else if (command === "tree") { const all = await service.all(); const rawDepth = stringFlag(args, "depth"); const status = statusFilter(args); const options: TreeOptions = { all: booleanFlag(args, "all") || status === "all", ...(status === undefined || status === "all" ? {} : { status }), ...(rawDepth === undefined ? {} : { depth: Number(rawDepth) }) }; if (options.depth !== undefined && (!Number.isInteger(options.depth) || options.depth < 1)) fail("invalid --depth: expected positive integer"); const tree = buildTree(all, options); value = { roots: tree.roots.map(treeNodeWire), visible: tree.visible, hidden: tree.hidden }; human = () => formatTree(tree); }
    else if (command === "migrate") { const report = await service.migrate(args); value = report; human = () => formatMigration(report); }
    else if (command === "doctor") { const all = await service.all(); value = { ok: true, backend: storage.backend, database: storage.location, database_path: storage.location, schema_version: 2, issues: all.length }; human = () => formatDoctor(value as Record<string, unknown>); }
    else if (command === "ping") { value = { ok: true, service: "tasks", schema_version: 2 }; human = () => "pong"; }
    else if (command === "comment") { const issue = await service.comment(args); value = issueWire(issue); human = () => confirmation("Comment added to", issue); }
    else if (command === "comments") {
      const { op, id, rest } = commentsArgs(args);
      if (op === "list") { const result = await service.reviewList(id); value = result; human = () => formatReviewComments(id, result); }
      else if (op === "send") { const result = await service.reviewSend(id, rest); value = result; human = () => formatReviewSend(id, result); }
      else {
        const cid = rest[0] ?? fail(`comments ${op} requires a comment id`);
        if (rest.length > 1) fail(`comments ${op} takes one comment id`);
        const result = await service.reviewStatus(id, cid, op === "resolve" ? "resolved" : op === "dismiss" ? "dismissed" : "open");
        value = result; human = () => formatReviewStatus(op, cid, id, result);
      }
    }
    else if (command === "dep") { const result = await service.dep(args); if (Array.isArray(result)) { value = result; human = () => formatDepList(result, args.positionals[2] ?? args.positionals[1] ?? "", stringFlag(args, "direction") ?? "down"); } else { const issue = result as Issue; value = issueWire(issue); human = () => confirmation("Dependency updated", issue); } }
    else if (command === "note") { const body = args.positionals.slice(2).join(" ") || fail("note requires text"); const issue = await service.note(args, body); value = issueWire(issue); human = () => confirmation("Note added to", issue); }
    else if (command === "assign") { const user = args.positionals[2] ?? fail("assign requires user"); const issue = await service.fieldPatch(args, "assignee", user); value = issueWire(issue); human = () => confirmation(`Assigned to ${user}`, issue); }
    else if (command === "priority") { const level = args.positionals[2] ?? fail("priority requires 0-4"); if (!/^[0-4]$/.test(level)) fail(`invalid priority: ${level} (expected 0-4)`); const issue = await service.fieldPatch(args, "priority", issuePriority(Number(level))); value = issueWire(issue); human = () => confirmation(`Priority P${level} set on`, issue); }
    else if (command === "tag") { const labelValue = args.positionals[2] ?? fail("tag requires label"); const issue = await service.tag(args, labelValue); value = issueWire(issue); human = () => confirmation(`Tagged #${labelValue} on`, issue); }
    else if (command === "delete" || command === "remove") { const removed = await service.remove(args); value = { deleted: [...removed] }; human = () => green(`✓ Deleted ${removed.length} issue(s): `) + removed.map((id) => cyan(id)).join(", "); }
    else if (command === "rename") { const renamed = await service.rename(args); value = renamed; human = () => green("✓ Renamed ") + cyan(renamed.from) + " → " + cyan(renamed.to); }
    else if (command === "children") { const kids = await service.children(args); value = kids.map(issueWire); const base = await webBase(root!); human = () => kids.length === 0 ? dim("No children") : formatList(kids, base); }
    else if (command === "epic") { const view = await service.epic(args); value = { epic: issueWire(view.epic), children: view.children.map(issueWire), closed: view.done, total: view.children.length, eligible_for_closure: view.eligible }; human = () => formatEpic(view); }
    else if (command === "graph") { const all = await service.all(); const rootId = args.positionals[1]; value = { nodes: all.map(issueWire), edges: all.flatMap((issue) => issue.dependencies.map((edge) => ({ from: issue.id, to: edge.target, type: edge.type }))) }; human = () => formatGraph(all, rootId); }
    else if (command === "stale") { const days = Number(stringFlag(args, "days") ?? 14); const cutoff = new Date(Date.now() - days * 86_400_000); const staleIssues = (await service.all()).filter((issue) => issue.status !== "closed" && issue.updatedAt < cutoff); value = staleIssues.map(issueWire); const base = await webBase(root!); human = () => formatStale(staleIssues, days, base); }
    else if (command === "orphans") { const orphans = (await service.all()).filter((issue) => issue.status !== "closed" && issue.assignee === null && issue.labels.length === 0 && issue.dependencies.length === 0 && issue.parentId === null); value = orphans.map(issueWire); human = () => formatOrphans(orphans); }
    else if (command === "duplicates" || command === "find-duplicates") { const all = await service.all(); const open = all.filter((issue) => issue.status !== "closed"); const pairs: Array<readonly [Issue, Issue, number]> = []; const tokenize = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 3)); const bags = open.map((issue) => ({ issue, tokens: tokenize(`${issue.title} ${issue.description}`) })); for (let a = 0; a < bags.length; a += 1) for (let b = a + 1; b < bags.length; b += 1) { const left = bags[a]!.tokens; const right = bags[b]!.tokens; if (left.size === 0 || right.size === 0) continue; const overlap = [...left].filter((token) => right.has(token)).length; const score = overlap / Math.max(left.size, right.size); if (score >= 0.5) pairs.push([bags[a]!.issue, bags[b]!.issue, score]); } pairs.sort((x, y) => y[2] - x[2]); value = pairs.map(([a, b, score]) => ({ a: issueWire(a), b: issueWire(b), similarity: score })); human = () => formatDuplicates(pairs); }
    else if (command === "link") { const issue = await service.link(args); value = issueWire(issue); human = () => confirmation("Linked", issue); }
    else if (command === "duplicate") { const issue = await service.markDuplicate(args); warnUnfrozenChangeset(issue); const of = stringFlag(args, "of") ?? ""; value = issueWire(issue); human = () => confirmation(`Marked duplicate of ${of}`, issue) + pruneSuffix(issue); }
    else if (command === "supersede") { const issue = await service.markSuperseded(args); warnUnfrozenChangeset(issue); const withId = stringFlag(args, "with") ?? ""; value = issueWire(issue); human = () => confirmation(`Marked superseded by ${withId}`, issue) + pruneSuffix(issue); }
    else if (command === "todo") {
      const sub = args.positionals[1];
      if (sub === "add") { const issue = await service.todoAdd(args); value = issueWire(issue); human = () => confirmation("Added TODO", issue); }
      else if (sub === "done") { const issues = await service.todoDone(args); issues.forEach(warnUnfrozenChangeset); value = issues.map(issueWire); human = () => issues.map((issue) => confirmation("Closed", issue) + pruneSuffix(issue)).join("\n"); }
      else { const issues = await service.todoList(sub === "list" && booleanFlag(args, "all")); value = issues.map(issueWire); human = () => formatTodo(issues); }
    }
    else if (command === "lint") { const results = await service.lint(args); value = results.map(({ issue, missing }) => ({ id: issue.id, title: issue.title, type: issue.type, missing: missing.map((section) => `## ${section}`), warnings: missing.length })); human = () => formatLint(results); }
    else if (command === "backup") { const info = await service.backup(args); value = info; human = () => formatBackup(info); }
    else if (command === "rename-prefix") { const result = await service.renamePrefix(args); value = result; human = () => formatRenamePrefix(result); }
    else if (command === "version") { value = { version: VERSION, service: "tk" }; human = () => formatVersion(); }
    else if (command === "quickstart") { value = { text: QUICKSTART }; human = () => QUICKSTART; }
    else if (command === "prime") { value = { text: PRIME }; human = () => PRIME; }
    else if (command === "finish") { const issue = await service.finish(args); await seedFinishCursor(tasksDir, stringFlag(args, "session") ?? process.env["TK_SESSION"] ?? "", issue.id); const wire = issueWire(issue);
      // PR-02: one stat card (counts + changes-view links, never a diff) on both the human and JSON paths.
      const view = await resolveChanges({ cwd: workspace }, issue, await webBase(root!)); wire["changes"] = changesWire(view);
      // 11-03: the handoff card links the recorded PR (local mirror only — finish never runs gh).
      wire["pr"] = readPrRecord(issue.metadata); value = wire; human = () => formatFinish(issue, view); }
    else if (["update", "close", "reopen", "defer", "undefer", "label", "set-state"].includes(command)) { const issue = await service.mutate(args, command); warnUnfrozenChangeset(issue); value = issueWire(issue); const verbs: Readonly<Record<string, string>> = { update: "Updated issue", close: "Closed", reopen: "Reopened", defer: "Deferred", undefer: "Restored", label: "Labels updated on", "set-state": "State changed on" }; human = () => confirmation(verbs[command] ?? "Updated", issue, command === "close" && stringFlag(args, "reason") !== undefined ? `: ${stringFlag(args, "reason")}` : "") + (command === "close" ? pruneSuffix(issue) : ""); }
    else if (command === "sprint") {
      const sub = args.positionals[1] ?? "list";
      const sprintValue = (sprint: Sprint): Record<string, unknown> => ({ id: sprint.id, name: sprint.name, status: sprint.status, completed_at: sprint.completedAt === null ? null : sprint.completedAt.toISOString(), created_at: sprint.createdAt.toISOString(), updated_at: sprint.updatedAt.toISOString() });
      if (sub === "list") { const sprints = await service.sprintList(); value = sprints.map(sprintValue); human = () => formatSprintList(sprints); }
      else if (sub === "start") { const outcome = await service.sprintStart(args.positionals[2] ?? fail("sprint start requires a name"), booleanFlag(args, "carry")); value = { sprint: sprintValue(outcome.sprint), closed: outcome.closed.map(sprintValue), moved: outcome.moved }; human = () => green(`✓ Started sprint ${outcome.sprint.id}`) + (outcome.closed.length > 0 ? dim(` — closed ${outcome.closed.map((sprint) => sprint.id).join(", ")}`) : "") + (outcome.moved.length > 0 ? dim(`, moved ${outcome.moved.length} issue(s) ${booleanFlag(args, "carry") ? "into the sprint" : "to backlog"}`) : ""); }
      else if (sub === "close") { const outcome = await service.sprintClose(); value = { sprint: sprintValue(outcome.sprint), moved: outcome.moved }; human = () => green(`✓ Closed sprint ${outcome.sprint.id}`) + (outcome.moved.length > 0 ? dim(` — moved ${outcome.moved.length} issue(s) to backlog`) : ""); }
      else if (sub === "add") { const issue = await service.sprintAdd(args.positionals[2] ?? fail("sprint add requires issue id")); value = issueWire(issue); human = () => confirmation("Added to active sprint", issue); }
      else if (sub === "remove") { const issue = await service.sprintRemove(args.positionals[2] ?? fail("sprint remove requires issue id")); value = issueWire(issue); human = () => confirmation("Moved to backlog", issue); }
      else if (sub === "move") { const issue = await service.sprintMove(args.positionals[2] ?? fail("sprint move requires issue id"), args.positionals[3] ?? fail("sprint move requires sprint slug")); value = issueWire(issue); human = () => confirmation("Moved sprint", issue); }
      else fail(`unknown sprint subcommand: ${sub} (expected list, start, close, add, remove, move)`);
    }
    else if (command === "agent") {
      const agentWire = (agent: Agent): Record<string, unknown> => ({ schema_version: 1, _type: "agent", id: agent.id, name: agent.name, description: agent.description, owner: agent.owner, runtime: agent.runtime, access: agent.access, mode: agent.mode, status: agent.status, instructions: agent.instructions, skills: agent.skills, env: agent.env, archived_at: agent.archivedAt === null ? null : agent.archivedAt.toISOString(), created_at: agent.createdAt.toISOString(), updated_at: agent.updatedAt.toISOString() });
      const sub = args.positionals[1] ?? fail("agent requires operation");
      if (sub === "create") { const agent = await service.agentCreate(args); value = agentWire(agent); human = () => green("✓ Registered agent ") + cyan(agent.id); }
      else if (sub === "list") { const agents = await service.agentList(args); value = agents.map(agentWire); human = () => formatAgentList(agents); }
      else if (sub === "get" || sub === "show") { const agent = await service.agentShow(args.positionals[2] ?? fail(`agent ${sub} requires agent id`)); value = agentWire(agent); human = () => formatAgentShow(agent); }
      else if (sub === "update") { const agent = await service.agentUpdate(args, args.positionals[2] ?? fail("agent update requires agent id")); value = agentWire(agent); human = () => green("✓ Updated agent ") + cyan(agent.id); }
      else if (sub === "archive") { const agent = await service.agentArchive(args.positionals[2] ?? fail("agent archive requires agent id")); value = agentWire(agent); human = () => green("✓ Archived agent ") + cyan(agent.id); }
      else if (sub === "unarchive") { const agent = await service.agentUnarchive(args.positionals[2] ?? fail("agent unarchive requires agent id")); value = agentWire(agent); human = () => green("✓ Unarchived agent ") + cyan(agent.id); }
      else if (sub === "copy") { const agent = await service.agentCopy(args, args.positionals[2] ?? fail("agent copy requires agent id")); value = agentWire(agent); human = () => green("✓ Copied agent ") + cyan(agent.id); }
      else if (sub === "issues") { const issues = await service.agentIssues(args, args.positionals[2] ?? fail("agent issues requires agent id")); value = issues.map(issueWire); const base = await webBase(root!); human = () => issues.length === 0 ? dim(`No issues assigned to ${args.positionals[2]}`) : formatList(issues, base); }
      else fail(`unknown agent subcommand: ${sub} (expected create, list, get, update, archive, unarchive, copy, issues)`);
    }
    else if (command === "runs" || command === "run") {
      const runWire = (run: Run): Record<string, unknown> => ({ schema_version: 1, _type: "run", id: run.id, issue_id: run.issueId, agent_id: run.agentId, trigger: run.trigger, state: run.state, started_at: run.startedAt === null ? null : run.startedAt.toISOString(), closed_at: run.closedAt === null ? null : run.closedAt.toISOString(), messages: run.messages.map((message) => ({ at: message.at.toISOString(), kind: message.kind, text: message.text })), usage: { tokens: run.usage.tokens, cost: run.usage.cost }, created_at: run.createdAt.toISOString(), updated_at: run.updatedAt.toISOString() });
      if (command === "runs") { const runs = await service.runsList(args); value = runs.map(runWire); human = () => formatRunList(runs); }
      else {
        const sub = args.positionals[1] ?? fail("run requires operation");
        if (sub === "show") { const run = await service.runShow(args.positionals[2] ?? fail("run show requires run id")); value = runWire(run); human = () => formatRunShow(run); }
        else if (sub === "cancel") { const run = await service.runCancel(args.positionals[2] ?? fail("run cancel requires run id")); value = runWire(run); human = () => green("✓ Cancelled run ") + cyan(run.id); }
        else if (sub === "rerun") { const run = await service.runRerun(args.positionals[2] ?? fail("run rerun requires run id")); value = runWire(run); human = () => green("✓ Queued rerun ") + cyan(run.id); }
        else if (sub === "message") { const body = booleanFlag(args, "stdin") ? await readInput() : args.positionals.slice(3).join(" "); if (body.trim() === "") fail("run message requires text or --stdin"); const run = await service.runMessage(args, args.positionals[2] ?? fail("run message requires run id"), body); value = runWire(run); human = () => green("✓ Message logged to ") + cyan(run.id); }
        else fail(`unknown run subcommand: ${sub} (expected show, cancel, rerun, message)`);
      }
    }
    else if (command === "archive") { const issue = await service.archive(args); value = issueWire(issue); human = () => confirmation("Archived", issue); }
    else if (command === "unarchive") { const issue = await service.unarchive(args); value = issueWire(issue); human = () => confirmation("Unarchived", issue); }
    else if (command === "runtime") {
      const sub = args.positionals[1] ?? fail("runtime requires operation (list, activity)");
      if (sub === "list") { const rows = await readRuntimeRegistry(tasksDir); value = rows.map((row) => ({ schema_version: 1, _type: "runtime_row", id: row.id, kind: row.kind, label: row.kind === "watch" ? row.label : null, pid: row.pid, started_at: row.startedAt, heartbeat_at: row.kind === "watch" ? row.heartbeatAt : null, subscriptions: row.kind === "watch" ? row.subscriptions : [], url: row.kind === "web" ? row.url : undefined })); human = () => formatRuntimeList(rows); }
      else if (sub === "activity") { const rawLimit = stringFlag(args, "limit"); const limit = rawLimit === undefined ? undefined : Number(rawLimit); if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) fail("invalid --limit: expected positive integer"); const rows = await readActivity(tasksDir, limit); value = rows.map((row) => ({ schema_version: 1, _type: "activity_row", at: row.at, runtime_id: row.runtimeId, kind: row.kind, detail: row.detail })); human = () => formatRuntimeActivity(rows); }
      else fail(`unknown runtime subcommand: ${sub} (expected list, activity)`);
    }
    else if (command === "lease") {
      const sub = args.positionals[1] ?? fail("lease requires operation (acquire, list, release, renew)");
      if (sub === "list") {
        const rows = await readLeases(tasksDir);
        value = rows.map(leaseWire);
        human = () => formatLeaseList(rows);
      }
      else if (sub === "acquire") {
        const name = args.positionals[2] ?? fail("lease acquire requires a resource name");
        const taskRef = stringFlag(args, "task");
        let issue: string | null = null;
        if (taskRef !== undefined) {
          const issueStore = await openSurfaceStore(root ?? fail("not in a tk workspace"));
          const resolved = await issueStore.transact(async (uow) => getOrThrow(uow, taskRef));
          if (!resolved.ok) fail(resolved.error.message);
          issue = resolved.value.id;
          await issueStore.close();
        }
        const request: LeaseRequest = { name, holder: leaseHolder(args), purpose: stringFlag(args, "purpose") ?? "-", ttlMs: leaseTtl(args), issue };
        try {
          const lease = await acquirePolling(tasksDir, request, leaseWait(args));
          value = leaseWire(lease);
          human = () => green(`✓ Leased ${lease.name} for ${lease.holder} — ${duration(Math.max(0, new Date(lease.expiresAt).getTime() - Date.now()) / 1000)} left`) + (lease.issue !== null ? dim(` (for ${lease.issue})`) : "");
        } catch (error) {
          if (error instanceof LeaseBusyError || error instanceof LeaseStateError) fail(error.message);
          throw error;
        }
      }
      else if (sub === "renew") {
        const name = args.positionals[2] ?? fail("lease renew requires a resource name");
        try {
          const lease = await renewLeaseFile(tasksDir, name, leaseHolder(args), leaseTtl(args));
          value = leaseWire(lease);
          human = () => green(`✓ Renewed ${lease.name} for ${lease.holder} — ${duration(Math.max(0, new Date(lease.expiresAt).getTime() - Date.now()) / 1000)} left`);
        } catch (error) {
          if (error instanceof LeaseBusyError || error instanceof LeaseStateError) fail(error.message);
          throw error;
        }
      }
      else if (sub === "release") {
        const name = args.positionals[2] ?? fail("lease release requires a resource name");
        try {
          await releaseLeaseFile(tasksDir, name, leaseHolder(args));
          value = { schema_version: 1, _type: "lease_released", name };
          human = () => green(`✓ Released ${name}`);
        } catch (error) {
          if (error instanceof LeaseStateError) fail(error.message);
          throw error;
        }
      }
      else fail(`unknown lease subcommand: ${sub} (expected acquire, list, release, renew)`);
    }
    else if (command === "inbox") {
      const sub = args.positionals[1];
      if (sub === "read" || sub === "archive") {
        const target = args.positionals[2] ?? fail(`inbox ${sub} requires run id`);
        if (sub === "read") await markInboxRead(tasksDir, target); else await markInboxArchived(tasksDir, target);
        const markers = await readInboxMarkers(tasksDir);
        value = { schema_version: 1, _type: "inbox_markers", run_id: target, read_at: markers.readAt, archived: markers.archived };
        human = () => green(`✓ ${sub === "read" ? "Read" : "Archived"} `) + cyan(target);
      }
      else {
        const markers = await readInboxMarkers(tasksDir);
        const entries = inboxEntries(await service.runsList(args), markers);
        const visible = booleanFlag(args, "all") ? entries : entries.filter((entry) => markers.archived[entry.runId] !== true);
        value = visible.map((entry) => ({ schema_version: 1, _type: "inbox_entry", run_id: entry.runId, issue_id: entry.issueId, agent_id: entry.agentId, state: entry.state, trigger: entry.trigger, last_updated_at: entry.lastUpdatedAt, unread: entry.unread }));
        human = () => formatInbox(visible);
      }
    }
    else fail(`unknown command: ${command}`);
    if (command === "export") { if (!json && !markdown) for (const record of value as readonly unknown[]) console.log(JSON.stringify(record)); else if (markdown) process.stdout.write(formatMarkdown(value, false)); else output(value, json); }
    else if (markdown) process.stdout.write(formatMarkdown(value, false));
    else if (!json && human !== null) console.log(human());
    else output(value, json); } finally { await storage.close(); } }
main().catch((error: unknown) => { const message = error instanceof Error ? error.message : String(error); if (process.argv.includes("--json")) { const kind: JsonError["error"]["kind"] = error instanceof ArgumentParseError ? "parse" : message.startsWith("readonly") ? "readonly" : message.includes("invalid") || message.startsWith("import line") ? "validation" : message.includes("not found") ? "not_found" : message.includes("held by") || message.includes("is held by") ? "conflict" : message.startsWith("no lease on") ? "not_found" : "runtime"; console.error(JSON.stringify({ error: { kind, message } } satisfies JsonError)); } else console.error(formatError(message)); exit(1); });
