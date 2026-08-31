#!/usr/bin/env bun
import { access, copyFile, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { cwd, exit, stdin } from "node:process";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { findBeadsWorkspace, inferPrefix, migrateBeadsJsonl, resolveBeadsJsonl, searchPath, type MigrationSummary } from "@tasks/beads";
import { dependencyTarget, issueDescription, issueFromBdWire, issueId, issuePriority, issueTitle, issueToBdWire, type Issue, type IssueId, type Metadata } from "@tasks/domain";
import { canonicalTimestampCodec, err, ok, type IssueUnitOfWork, type Result } from "@tasks/application";
import { DEFAULT_STORAGE, describeStorage, openEphemeralScratch, openStorage, readWorkspaceConfig, resolveStorageConfig, writeWorkspaceConfig, type StorageAdapter, type StorageConfig, type WorkspaceConfig } from "@tasks/workspace";
import { booleanFlag, directory, parseArgs, stringFlag, ArgumentParseError, type ParsedArgs } from "./args.js";
import { gitCommonDir, gitCurrentBranch, gitDefaultBranch, gitHasUncommittedChanges, gitHasUnpushedCommits, gitStashCount, gitToplevel, gitWorktreeAdd, gitWorktreeList, gitWorktreeRemove, mainWorktreeRoot } from "./git.js";
import {
  commentWire, confirmation, formatBackup, formatBlocked, formatComments, formatCount, formatDepList, formatDoctor,
  formatDuplicates, formatEpic, formatGraph, formatHistory, formatLint, formatList, formatMigration, formatOrphans,
  formatReady, formatRenamePrefix, formatSearch, formatShow, formatStale, formatStats,
  formatStatus, formatStatuses, formatTodo, formatTree, formatTypes, formatVersion, formatWhere, formatWorktreeInfo, formatWorktreeList,
  HUMAN_HELP, INIT_HELP, LINT_SECTIONS, ONBOARD, PRIME, QUICKSTART, SWITCH_BACKEND_HELP, cyan, dim, formatError, green, issueWire, output, treeNodeWire,
} from "./presentation.js";
import { bunRunner } from "./git.js";
import { formatHunkComment, hunkCommentMetaKey, parseHunkComments, pendingHunkComments, planHunk, scratchDirectory, writeAgentContext } from "./hunk.js";
import { buildTree, type TreeOptions } from "./tree.js";

/** bd-style collision-resistant issue IDs: <prefix>-<base36 hash>, short like bd (bd-0t0, bd-45g). */
const generateId = (): string => randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");
/** Start at 3 chars (like bd), grow on collision pressure. */
const idLength = (taken: number): number => (taken < 50 ? 3 : taken < 1_000 ? 4 : 6);

const writers = new Set(["init", "create", "q", "update", "close", "reopen", "defer", "undefer", "comment", "note", "assign", "priority", "tag", "dep", "label", "set-state", "import", "migrate", "delete", "remove", "rename", "link", "duplicate", "supersede", "todo", "backup", "rename-prefix", "switch-backend"]);
/** Stable stderr JSON error contract: { error: { kind, message } }. */
type JsonError = { readonly error: { readonly kind: "parse" | "validation" | "readonly" | "runtime"; readonly message: string } };
type Config = WorkspaceConfig;
const fail = (message: string): never => { throw new Error(message); };
const errorWire = (_key: string, value: unknown): unknown => value instanceof Error ? { name: value.name, message: value.message } : value;
const unwrap = <T, E>(result: Result<T, E>): T => { if (result.ok) return result.value; const error = result.error; const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : JSON.stringify(error, errorWire); return fail(message); };
/** Bun.stdin reads both pipes and file redirects; async-iterating `stdin` misses redirects. */
const readInput = async (): Promise<string> => (await Bun.stdin.text()).trimEnd();
const timeFrom = (value: unknown, fallback: Date): Date => { const parsed = new Date(String(value)); return Number.isNaN(parsed.valueOf()) ? fallback : parsed; };
const parseDate = (value: string | undefined): Date | null | undefined => { if (value === undefined) return undefined; if (value === "" || value === "null") return null; const date = new Date(value); if (Number.isNaN(date.valueOf())) fail(`invalid date: ${value}`); return date; };
const parseMetadata = (value: string | undefined): Metadata | undefined => { if (value === undefined) return undefined; const parsed: unknown = JSON.parse(value); if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") fail("metadata must be JSON object"); return parsed as Metadata; };
const metadataEntry = (value: string): readonly [string, Metadata[string]] => { const separator = value.indexOf("="); if (separator <= 0) fail("metadata entry must be key=value"); const key = value.slice(0, separator); const raw = value.slice(separator + 1); try { return [key, JSON.parse(raw) as Metadata[string]]; } catch { return [key, raw]; } };
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
const KNOWN_STATUSES: readonly string[] = ["open", "in_progress", "ready-to-review", "approved", "rejected", "closed"];
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
    const path = resolve(start, name);
    const outcome = await gitWorktreeAdd(start, path, branch);
    if (!outcome.ok) fail(outcome.stderr || `failed to create worktree at ${path}`);
    // No .tasks/ redirect to write: rootFrom() already follows git-common-dir
    // back to the main worktree, exactly like git worktree itself.
    const gitignore = join(mainRoot, ".gitignore");
    const relative = path.startsWith(`${mainRoot}/`) ? path.slice(mainRoot.length + 1) : null;
    if (relative !== null) { const existing = await readFile(gitignore, "utf8").catch(() => ""); if (!existing.split("\n").includes(relative)) await writeFile(gitignore, `${existing}${existing.endsWith("\n") || existing === "" ? "" : "\n"}${relative}\n`); }
    const result = { name, path, branch, created: true };
    if (json) output(result, true); else console.log(`${green("\u2713 Created worktree")} ${cyan(path)} on branch ${branch}`);
    return;
  }
  if (sub === "remove") {
    if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes");
    const name = args.positionals[2] ?? fail("worktree remove requires <name>");
    const force = booleanFlag(args, "force");
    const entries = await gitWorktreeList(start);
    const target = entries.find((entry) => entry.path === resolve(start, name) || entry.path.endsWith(`/${name}`)) ?? fail(`no such worktree: ${name}`);
    if (!force) {
      const [dirty, unpushed, stashes] = await Promise.all([gitHasUncommittedChanges(target.path), gitHasUnpushedCommits(target.path), gitStashCount(target.path)]);
      const problems = [dirty ? "uncommitted changes" : null, unpushed ? "unpushed commits" : null, stashes > 0 ? `${stashes} stash(es)` : null].filter((entry): entry is string => entry !== null);
      if (problems.length > 0) fail(`refusing to remove ${target.path}: ${problems.join(", ")} — use --force to override`);
    }
    const outcome = await gitWorktreeRemove(start, target.path, force);
    if (!outcome.ok) fail(outcome.stderr || `failed to remove worktree at ${target.path}`);
    const result = { name, path: target.path, removed: true };
    if (json) output(result, true); else console.log(`${green("\u2713 Removed worktree")} ${cyan(target.path)}`);
    return;
  }
  fail(`unknown worktree subcommand: ${sub}; expected create, list, remove, or info`);
}
const get = async (uow: IssueUnitOfWork, raw: string): Promise<Issue> => { const issue = unwrap(await uow.findById(issueId(raw))); return issue ?? fail(`issue not found: ${raw}`); };
const transaction = async <T>(database: StorageAdapter, work: (uow: IssueUnitOfWork) => Promise<T>): Promise<T> => unwrap(await database.withinTransaction(async (uow) => { try { return ok(await work(uow)); } catch (cause) { return err({ kind: "repository", operation: "cli", cause }); } }));
const changed = (issue: Issue, patch: Partial<Issue>): Issue => ({ ...issue, ...patch, updatedAt: new Date() });
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
  private async currentId(): Promise<string> { const value = await readFile(join(this.root, ".tasks", "current"), "utf8").catch(() => ""); return value.trim() || fail("no current issue selected"); }
  private async setCurrent(id: IssueId): Promise<void> { await writeFile(join(this.root, ".tasks", "current"), `${id}\n`); }
  private async selected(args: ParsedArgs): Promise<string> { return args.positionals[1] ?? (booleanFlag(args, "current") ? this.currentId() : fail("issue id required")); }
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
      const issue: Issue = { id: issueId(candidate), title: issueTitle(title), description: issueDescription(description), status: stringFlag(args, "status") ?? "open", priority: issuePriority(Number(stringFlag(args, "priority") ?? 2)), type: stringFlag(args, "type") ?? "task", owner: stringFlag(args, "owner") ?? null, assignee: stringFlag(args, "assignee") ?? null, createdBy: this.actor, createdAt: now, updatedAt: now, startedAt: null, closedAt: null, dueAt: parseDate(stringFlag(args, "due")) ?? null, deferUntil: parseDate(stringFlag(args, "defer-until")) ?? null, parentId: parent === undefined ? null : issueId(parent), labels: (stringFlag(args, "labels") ?? stringFlag(args, "label") ?? "").split(",").filter(Boolean), notes: stringFlag(args, "notes") ?? null, design: stringFlag(args, "design") ?? null, acceptanceCriteria: stringFlag(args, "acceptance") ?? null, estimate: estimate === undefined ? null : Number(estimate), specId: stringFlag(args, "spec-id") ?? null, externalRef: stringFlag(args, "external-ref") ?? null, branch: stringFlag(args, "branch") ?? null, metadata: parseMetadata(stringFlag(args, "metadata")) ?? {}, wireUnknown: {}, dependencies: [], dependencyCount: 0, dependentCount: 0, comments: [], commentCount: 0 };
      unwrap(await uow.save(issue)); for (const entry of (stringFlag(args, "deps") ?? "").split(",").filter(Boolean)) { const [kind, target] = entry.includes(":") ? entry.split(/:(.*)/s) : ["blocks", entry]; unwrap(await uow.addDependency({ issueId: issue.id, target: dependencyTarget(target!), type: kind!, createdAt: now, createdBy: this.actor, metadata: {}, wireUnknown: {} })); }
      const made = await get(uow, issue.id); await this.setCurrent(made.id); return made;
    });
  }
  async show(args: ParsedArgs): Promise<Issue> { return transaction(this.database, (uow) => this.selected(args).then((id) => get(uow, id))); }
  async all(): Promise<readonly Issue[]> { return transaction(this.database, async (uow) => unwrap(await uow.list({ limit: 100_000 })).items); }
  async history(args: ParsedArgs): Promise<readonly Record<string, unknown>[]> { return transaction(this.database, async (uow) => { const id = issueId(await this.selected(args)); await get(uow, id); return (unwrap(await uow.history(id))).map((entry) => ({ id: entry.id, issue_id: entry.issueId, action: entry.action, at: entry.at.toISOString(), actor: entry.actor, data: entry.data })); }); }
  /** Import is migration of an already-materialised stream: same decoder, same ordering, same atomicity. */
  async importJsonl(input: string): Promise<number> {
    const result = await migrateBeadsJsonl(this.database, input, { onConflict: "overwrite", strict: true, timestamps: canonicalTimestampCodec });
    if (result.ok) return result.value.imported;
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
  async list(args: ParsedArgs, ready: boolean): Promise<readonly Issue[]> { const query = statusFilter(args); return transaction(this.database, async (uow) => { const page = unwrap(await uow.list({ ...(query === undefined || query === "all" ? {} : { status: query }), limit: Number(stringFlag(args, "limit") ?? 1000) })); let items = page.items.filter((issue) => (stringFlag(args, "parent") === undefined || issue.parentId === stringFlag(args, "parent")) && (stringFlag(args, "assignee") === undefined || issue.assignee === stringFlag(args, "assignee")) && (stringFlag(args, "type") === undefined || issue.type === stringFlag(args, "type")) && (stringFlag(args, "priority") === undefined || issue.priority === Number(stringFlag(args, "priority"))) && (stringFlag(args, "label") === undefined || issue.labels.includes(stringFlag(args, "label")!)));
    if (!ready) return items; const now = new Date(); items = items.filter((issue) => issue.status === "open" && (issue.deferUntil === null || issue.deferUntil <= now) && !issue.dependencies.some((edge) => edge.type === "blocks" && page.items.some((candidate) => candidate.id === edge.target && candidate.status !== "closed")));
    if (!booleanFlag(args, "claim")) return items; const pick = items[0] ?? fail("no ready issue to claim"); const claimed = unwrap(await uow.claimReady(pick.id, this.actor)); await this.setCurrent(claimed.id); return [claimed]; }); }
  async comment(args: ParsedArgs): Promise<Issue> { const id = await this.selected(args); let body = args.positionals.slice(2).join(" ") || stringFlag(args, "body") || ""; if (booleanFlag(args, "stdin")) body = await readInput(); if (!body) fail("comment requires body"); return transaction(this.database, async (uow) => { unwrap(await uow.addComment(issueId(id), this.actor, body)); return get(uow, id); }); }
  async comments(args: ParsedArgs): Promise<Issue> { return this.show(args); }
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
    const result = changed(issue, patch); unwrap(await uow.save(result)); if (command === "close" || command === "reopen" || command === "set-state") await this.setCurrent(result.id); return result; }); }
  /** Quick capture (`bd q`): create and return only the new id. */
  async quick(args: ParsedArgs): Promise<string> { return (await this.create(args)).id; }
  /** Field shorthand used by `assign`/`priority`: patch one field on the selected issue. */
  async fieldPatch(args: ParsedArgs, key: "assignee", value: string): Promise<Issue>;
  async fieldPatch(args: ParsedArgs, key: "priority", value: number): Promise<Issue>;
  async fieldPatch(args: ParsedArgs, key: "assignee" | "priority", value: string | number): Promise<Issue> { const id = await this.selected(args); return transaction(this.database, async (uow) => { const issue = await get(uow, id); const patch: Partial<Issue> = key === "assignee" ? { assignee: String(value) } : { priority: issuePriority(Number(value)) }; const result = changed(issue, patch); unwrap(await uow.save(result)); return result; }); }
  async note(args: ParsedArgs, body: string): Promise<Issue> { const id = await this.selected(args); return transaction(this.database, async (uow) => { const issue = await get(uow, id); const result = changed(issue, { notes: [issue.notes, body].filter(Boolean).join("\n") }); unwrap(await uow.save(result)); return result; }); }
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
    const current = await readFile(join(this.root, ".tasks", "current"), "utf8").catch(() => "");
    if (current.trim() === from) await this.setCurrent(issueId(to));
  }
  /** Rename an issue id, retargeting parents and dependencies that reference it. */
  async rename(args: ParsedArgs): Promise<{ readonly from: string; readonly to: string }> { const from = args.positionals[1] ?? fail("rename requires old id"); const to = args.positionals[2] ?? fail("rename requires new id"); return transaction(this.database, async (uow) => { const page = unwrap(await uow.list({ limit: 100_000 })); await this.renameOne(uow, page, from, to); return { from, to }; }); }
  /** Delete one or more issues, cleaning references (`bd delete`). */
  async remove(args: ParsedArgs): Promise<readonly string[]> { const ids = args.positionals.slice(1); if (ids.length === 0) fail("delete requires at least one id"); return transaction(this.database, async (uow) => { for (const id of ids) await get(uow, id); for (const id of ids) unwrap(await uow.delete(issueId(id))); return ids; }); }
  /** `bd link`: shorthand for `dep add`, default type "blocks", id2 blocks id1. */
  async link(args: ParsedArgs): Promise<Issue> { const id = args.positionals[1] ?? fail("link requires <id1> <id2>"); const target = args.positionals[2] ?? fail("link requires <id1> <id2>"); const type = stringFlag(args, "type") ?? "blocks"; return transaction(this.database, async (uow) => { const issue = await get(uow, id); await get(uow, target); unwrap(await uow.addDependency({ issueId: issue.id, target: dependencyTarget(target), type, createdAt: new Date(), createdBy: this.actor, metadata: {}, wireUnknown: {} })); return get(uow, id); }); }
  /** `bd duplicate <id> --of <canonical>`: close id, record canonical in notes. */
  async markDuplicate(args: ParsedArgs): Promise<Issue> { const id = args.positionals[1] ?? fail("duplicate requires <id>"); const canonical = stringFlag(args, "of") ?? fail("duplicate requires --of <canonical>"); return transaction(this.database, async (uow) => { const issue = await get(uow, id); await get(uow, canonical); const result = changed(issue, { status: "closed", closedAt: new Date(), notes: [issue.notes, `Duplicate of ${canonical}`].filter(Boolean).join("\n") }); unwrap(await uow.save(result)); return result; }); }
  /** `bd supersede <id> --with <new>`: close id, record replacement in notes. */
  async markSuperseded(args: ParsedArgs): Promise<Issue> { const id = args.positionals[1] ?? fail("supersede requires <id>"); const replacement = stringFlag(args, "with") ?? fail("supersede requires --with <new>"); return transaction(this.database, async (uow) => { const issue = await get(uow, id); await get(uow, replacement); const result = changed(issue, { status: "closed", closedAt: new Date(), notes: [issue.notes, `Superseded by ${replacement}`].filter(Boolean).join("\n") }); unwrap(await uow.save(result)); return result; }); }
  /** `bd todo`: task-type issues, with `add`/`done`/`list` shortcuts. */
  async todoAdd(args: ParsedArgs): Promise<Issue> { const title = args.positionals.slice(2).join(" ") || fail("todo add requires title"); return this.create({ ...args, positionals: [args.positionals[0]!, title], flags: new Map([...args.flags, ["type", "task"]]) }); }
  async todoDone(args: ParsedArgs): Promise<readonly Issue[]> { const ids = args.positionals.slice(2); if (ids.length === 0) fail("todo done requires at least one id"); const reason = stringFlag(args, "reason") ?? "Completed"; return transaction(this.database, async (uow) => { const results: Issue[] = []; for (const id of ids) { const issue = await get(uow, id); const result = changed(issue, { status: "closed", closedAt: new Date(), notes: [issue.notes, reason].filter(Boolean).join("\n") }); unwrap(await uow.save(result)); results.push(result); } return results; }); }
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
      const current = await readFile(join(this.root, ".tasks", "current"), "utf8").catch(() => "");
      const remapped = mapping.get(current.trim());
      if (remapped !== undefined) await this.setCurrent(issueId(remapped));
      const tasksDir = join(this.root, ".tasks"); const currentConfig = await readWorkspaceConfig(tasksDir); await writeWorkspaceConfig(tasksDir, { ...currentConfig, prefix: to.replace(/-$/, "") });
      return { from, to, renamed: mapping.size, dryRun };
    });
  }
  /**
   * `tk hunk <id>` — open a Hunk review of the issue's changes, or `sync` its
   * live review comments into the issue. Launch plan logic lives in hunk.ts.
   */
  async hunk(args: ParsedArgs): Promise<{ readonly value: Record<string, unknown>; readonly human: (() => string) | null }> {
    // Positional layout: `hunk <id>` or `hunk <id> sync` — anything else is rejected.
    const rest = args.positionals.slice(1);
    const sync = rest.includes("sync") || booleanFlag(args, "sync");
    const issueArgs = args.positionals[1] === "sync" ? { ...args, positionals: [args.positionals[0]!, ...args.positionals.slice(2)] } : args;
    const issue = await transaction(this.database, (uow) => this.selected(issueArgs).then((id) => get(uow, id)));
    const toplevel = await gitToplevel(this.root);
    let reviewCwd = toplevel ?? this.root;
    if (issue.branch !== null && await gitCurrentBranch(reviewCwd) !== issue.branch) {
      const worktree = (await gitWorktreeList(reviewCwd)).find((entry) => entry.branch === issue.branch);
      if (worktree === undefined) fail(`branch ${issue.branch} is not checked out; run tk worktree create or open tk hunk from that branch`);
      reviewCwd = worktree!.path;
    }
    const reviewRoot = await gitToplevel(reviewCwd);
    if (!sync) {
      // Any positional beyond the issue id (e.g. `--mode split`) is forwarded to hunk verbatim.
      const extras = rest.filter((token) => token !== (issue.id as string));
      const scratch = await scratchDirectory();
      const agentContext = await writeAgentContext(issue, scratch);
      const defaultBranch = issue.branch === null ? null : await gitDefaultBranch(reviewCwd);
      if (issue.branch !== null && defaultBranch === null) fail(`could not identify the default branch for ${issue.branch}; configure origin/HEAD or create main/master`);
      const base = defaultBranch === null ? null : await bunRunner.run(["git", "merge-base", issue.branch!, defaultBranch], reviewCwd).then((result) => result.code === 0 ? result.stdout : fail(`could not resolve merge base for branch ${issue.branch}: ${result.stderr || "branch not found"}`));
      const plan = planHunk(base, reviewCwd, reviewRoot, extras, agentContext);
      if (booleanFlag(args, "print")) {
        return { value: { id: issue.id, argv: plan.argv, cwd: plan.cwd, mode: plan.mode, agent_context: plan.agentContext }, human: () => `${cyan(plan.argv.join(" "))}  ${dim(`# cwd: ${plan.cwd}`)}\n${dim(`# agent-context: ${plan.agentContext}`)}` };
      }
      const spawned = Bun.spawn([...plan.argv], { cwd: plan.cwd, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
      const code = await spawned.exited;
      return { value: { id: issue.id, command: plan.argv.join(" "), cwd: plan.cwd, exit_code: code }, human: null };
    }
    if (reviewRoot === null) fail("hunk sync requires a git repository");
    const session = await bunRunner.run(["hunk", "session", "comment", "list", "--repo", reviewRoot!, "--json"], reviewCwd);
    if (session.code !== 0) fail(`hunk session comment list failed: ${session.stderr || "no active session"}`);
    const comments = parseHunkComments(session.stdout);
    const knownIds = readHunkCommentIds(issue);
    const pending = pendingHunkComments(comments, knownIds);
    if (pending.imported.length === 0) return { value: { id: issue.id, imported: 0, skipped: pending.skipped, total: comments.length }, human: () => green(`✓ No new hunk comments for ${issue.id}`) + dim(` (${pending.skipped} already synced)`) };
    const updated = await transaction(this.database, async (uow) => {
      const current = await get(uow, issue.id);
      const known = new Set(readHunkCommentIds(current));
      const fresh = pending.imported.filter((comment) => !known.has(comment.commentId));
      const metadata: Metadata = { ...current.metadata, [hunkCommentMetaKey]: [...readHunkCommentIds(current), ...fresh.map((comment) => comment.commentId)] };
      const hunkComments = fresh.map((comment) => ({ id: `hunk-${comment.commentId}`, issueId: current.id, author: comment.author ?? "hunk", text: formatHunkComment(comment), createdAt: new Date(comment.createdAt ?? Date.now()), wireUnknown: { hunkCommentId: comment.commentId } }));
      unwrap(await uow.save(changed(current, { metadata, comments: [...current.comments, ...hunkComments], commentCount: current.commentCount + hunkComments.length })));
      return get(uow, current.id);
    });
    return { value: { id: updated.id, imported: pending.imported.length, skipped: pending.skipped, total: comments.length, comments: commentWire(updated) }, human: () => green(`✓ Imported ${pending.imported.length} hunk comment(s) into ${updated.id}`) + (pending.skipped > 0 ? dim(` (${pending.skipped} already synced)`) : "") };
  }
}

/** Stable machine-readable migration contract; every non-imported record is accounted for. */
const migrationReport = (summary: MigrationSummary, source: string, directory: string): Record<string, unknown> => ({
  migrated: !summary.dryRun, dry_run: summary.dryRun, source, source_path: directory,
  read: summary.read, imported: summary.imported,
  skipped: [...summary.skipped], overwritten: [...summary.overwritten],
  carried: summary.carried.map((record) => ({ line: record.line, type: record.type })),
  rejected: summary.rejected.map((record) => ({ line: record.line, field: record.field, message: record.message })),
  detached_parents: summary.detachedParents.map((entry) => ({ id: entry.issueId, parent: entry.parentId })),
  cycles: summary.cycles.map((cycle) => [...cycle.members]),
});

/** Hunk comment ids already recorded on an issue (used for sync dedupe). */
const readHunkCommentIds = (issue: Issue): readonly string[] => { const value = issue.metadata[hunkCommentMetaKey]; return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; };


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
  comments <id>           View comments
  note <id> <text>        Append a note
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
  hunk <id> [--print]     Open a Hunk review of the issue's branch/WIP (--print shows the command)
  hunk <id> sync          Import live Hunk review comments into the issue (deduped)

  watch [--kinds k1,k2] [--ids id1,id2] [--label l] [--interval ms]
                          Watch for changes (NDJSON events on stdout)
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
  worktree create <name>  Create a git worktree sharing this .tasks/ workspace
  worktree list           List worktrees and their tasks-workspace state
  worktree info           Show tasks-workspace state for the current worktree
  worktree remove <name>  Remove a worktree (with safety checks)
  version                 Print version information
  quickstart              Quick start guide
  prime                   AI-optimized workflow context
  onboard                 Snippet for your agent instructions file
  human                   Focused help menu for human users

GLOBAL FLAGS
  --json                  Output as JSON
  --readonly              Reject writes
  -C, --directory <path>  Change directory before running (like git -C)
  --actor <name>          Override actor identity
  -h, --help              Show this help

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
`;
/**
 * `tk watch` — foreground workspace watcher: prints NDJSON event frames
 * (`ready`/`event`/`error`) to stdout as issues change. Exit 0 on EOF (stdin
 * closed), 2 when no workspace, 3 after repeated backend errors. The
 * pi/omp extension spawns this same loop as a child process.
 */
async function runWatch(args: ParsedArgs, start: string): Promise<void> {
  const root = await rootFrom(start);
  if (root === null) fail(await beadsHint(start));
  const { openSurfaceStore, runWatchChild, parseWatchArgs } = await import("@tasks/surface");
  const store = await openSurfaceStore(root!, { readonly: true });
  try {
    const argv: string[] = [];
    const kinds = stringFlag(args, "kinds"); if (kinds !== undefined) argv.push("--kinds", kinds);
    const ids = stringFlag(args, "ids"); if (ids !== undefined) argv.push("--ids", ids);
    const label = stringFlag(args, "label"); if (label !== undefined) argv.push("--label", label);
    const interval = stringFlag(args, "interval"); if (interval !== undefined) argv.push("--interval", interval);
    await runWatchChild(store, parseWatchArgs(argv));
  } finally {
    await store.close();
  }
}

async function main(): Promise<void> { const args = parseArgs(process.argv.slice(2)); const command = args.positionals[0] ?? "help"; const json = booleanFlag(args, "json"); const start = directory(args, cwd()); let root = await rootFrom(start);
  if (command === "init" && (booleanFlag(args, "help") || booleanFlag(args, "h"))) { process.stdout.write(INIT_HELP); return; }
  if (command === "help" && args.positionals[1] === "init") { process.stdout.write(INIT_HELP); return; }
  if (command === "switch-backend" && (booleanFlag(args, "help") || booleanFlag(args, "h"))) { process.stdout.write(SWITCH_BACKEND_HELP); return; }
  if (command === "help" && args.positionals[1] === "switch-backend") { process.stdout.write(SWITCH_BACKEND_HELP); return; }
  if (command === "help" || booleanFlag(args, "help") || booleanFlag(args, "h")) { process.stdout.write(HELP); return; }
  if (command === "watch") { await runWatch(args, start); return; }
  if (command === "worktree") { await runWorktree(args, start, json); return; }
  if (command === "init") { if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes"); const initRoot = start; root = initRoot; const prefix = stringFlag(args, "prefix") ?? "tk"; const storageConfig = initStorageConfig(args); await mkdir(join(initRoot, ".tasks"), { recursive: true }); const initConfig: Config = { prefix, storage: storageConfig }; await writeWorkspaceConfig(join(initRoot, ".tasks"), initConfig); const storage = await openStorage(join(initRoot, ".tasks"), initConfig.storage ?? DEFAULT_STORAGE); try { unwrap(await storage.adapter.migrate()); } finally { await storage.close(); } if (json) output({ workspace: initRoot, prefix, backend: storage.backend, initialized: true }, true); else console.log(`${green("✓ Initialized")} tasks workspace in ${cyan(join(initRoot, ".tasks"))} (prefix: ${prefix}, backend: ${storage.backend})`); return; }
  // migrate bootstraps its own workspace so a beads-only checkout needs no separate init,
  // except under --dry-run, which must leave the filesystem untouched.
  const bootstrapping = root === null && command === "migrate";
  const ephemeral = bootstrapping && booleanFlag(args, "dry-run");
  if (bootstrapping) { if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes"); if (!ephemeral) { await mkdir(join(start, ".tasks"), { recursive: true }); await writeWorkspaceConfig(join(start, ".tasks"), { prefix: stringFlag(args, "prefix") ?? "tk", storage: DEFAULT_STORAGE }); } root = start; }
  if (root === null) {
    // Git hook context: exit silently when no workspace found (don't interrupt commits)
    if (process.env["BD_GIT_HOOK"]) exit(0);
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
  const storage = ephemeral ? await openEphemeralScratch() : await openStorage(tasksDir, await resolveStorageConfig(tasksDir, config), { readonly }); try { if (readonly) { if (unwrap(await storage.adapter.hasPendingMigrations())) fail("readonly mode requires current database; pending migrations detected"); } else unwrap(await storage.adapter.migrate()); const service = new CommandService(storage.adapter, workspace, config, stringFlag(args, "actor") ?? process.env["USER"] ?? "unknown", storage.backend, storage.backend === "postgres" ? null : storage.location);
    // Every dispatch produces the JSON value plus an optional human formatter.
    // JSON stays byte-identical for agents; humans get colored, iconed output.
    let value: unknown; let human: (() => string) | null = null;
    if (command === "create") { const issue = await service.create(args); value = issueWire(issue); human = () => confirmation("Created issue", issue); }
    else if (command === "q") { const id = await service.quick(args); value = { id }; human = () => id; }
    else if (command === "show") { const issue = await service.show(args); value = [issueWire(issue)]; human = () => formatShow(issue); }
    else if (command === "list" || command === "ready") { const issues = await service.list(args, command === "ready"); value = issues.map(issueWire); human = () => (command === "ready" ? formatReady(issues) : formatList(issues)); }
    else if (command === "blocked") { const all = await service.all(); const blocked = all.filter((issue) => issue.dependencies.some((edge) => edge.type === "blocks" && all.some((other) => other.id === edge.target && other.status !== "closed"))); value = blocked.map(issueWire); human = () => formatBlocked(blocked, all); }
    else if (command === "count") { const all = await service.all(); value = { total: all.length, by_status: Object.fromEntries([...new Set(all.map((issue) => issue.status))].sort().map((status) => [status, all.filter((issue) => issue.status === status).length])), by_type: Object.fromEntries([...new Set(all.map((issue) => issue.type))].sort().map((type) => [type, all.filter((issue) => issue.type === type).length])) }; human = () => formatCount(value as { total: number; by_status: Record<string, number>; by_type: Record<string, number> }); }
    else if (command === "status") { const all = await service.all(); value = Object.fromEntries([...new Set(all.map((issue) => issue.status))].sort().map((status) => [status, all.filter((issue) => issue.status === status).length])); human = () => formatStatus(value as Record<string, number>); }
    else if (command === "stats") { const all = await service.all(); const now = new Date(); const blockedIds = new Set(all.filter((issue) => issue.dependencies.some((edge) => edge.type === "blocks" && all.some((other) => other.id === edge.target && other.status !== "closed"))).map((issue) => issue.id)); const tally = (status: string) => all.filter((issue) => issue.status === status).length; value = { total: all.length, open: tally("open"), in_progress: tally("in_progress"), ready_to_review: tally("ready-to-review"), approved: tally("approved"), rejected: tally("rejected"), blocked: blockedIds.size, closed: tally("closed"), deferred: tally("deferred"), ready: all.filter((issue) => issue.status === "open" && !blockedIds.has(issue.id) && (issue.deferUntil === null || issue.deferUntil <= now)).length }; human = () => formatStats(value as { total: number; open: number; in_progress: number; ready_to_review: number; approved: number; rejected: number; blocked: number; closed: number; deferred: number; ready: number }); }
    else if (command === "query") { const expression = args.positionals.slice(1).join(" ") || fail("query requires expression"); const issues = queryIssues(await service.all(), expression); value = issues.map(issueWire); human = () => formatList(issues); }
    else if (command === "search") { const text = args.positionals.slice(1).join(" ").trim() || fail("search requires text"); const needle = text.toLowerCase(); const issues = (await service.all()).filter((issue) => [issue.id, issue.title, issue.description, issue.notes ?? "", ...issue.labels].join("\n").toLowerCase().includes(needle)); value = issues.map(issueWire); human = () => formatSearch(issues, text); }
    else if (command === "import") { const count = await service.importJsonl(await readInput()); value = { imported: count }; human = () => green(`✓ Imported ${count} issue(s)`); }
    else if (command === "history") { const entries = await service.history(args); value = entries; human = () => formatHistory(entries, args.positionals[1] ?? "current"); }
    else if (command === "types") { const used = [...new Set((await service.all()).map((issue) => issue.type))].sort(); value = used; human = () => formatTypes(used); }
    else if (command === "statuses") { const used = [...new Set([...KNOWN_STATUSES, ...(await service.all()).map((issue) => issue.status)])].sort(); value = used; human = () => formatStatuses(used); }
    else if (command === "export") value = (await service.all()).map((issue) => issueToBdWire({ version: 1, issue, unknown: issue.wireUnknown }, canonicalTimestampCodec));
    else if (command === "tree") { const all = await service.all(); const rawDepth = stringFlag(args, "depth"); const status = statusFilter(args); const options: TreeOptions = { all: booleanFlag(args, "all") || status === "all", ...(status === undefined || status === "all" ? {} : { status }), ...(rawDepth === undefined ? {} : { depth: Number(rawDepth) }) }; if (options.depth !== undefined && (!Number.isInteger(options.depth) || options.depth < 1)) fail("invalid --depth: expected positive integer"); const tree = buildTree(all, options); value = { roots: tree.roots.map(treeNodeWire), visible: tree.visible, hidden: tree.hidden }; human = () => formatTree(tree); }
    else if (command === "migrate") { const report = await service.migrate(args); value = report; human = () => formatMigration(report); }
    else if (command === "doctor") { const all = await service.all(); value = { ok: true, backend: storage.backend, database: storage.location, database_path: storage.location, schema_version: 2, issues: all.length }; human = () => formatDoctor(value as Record<string, unknown>); }
    else if (command === "ping") { value = { ok: true, service: "tasks", schema_version: 2 }; human = () => "pong"; }
    else if (command === "comment") { const issue = await service.comment(args); value = issueWire(issue); human = () => confirmation("Comment added to", issue); }
    else if (command === "comments") { const issue = await service.comments(args); value = commentWire(issue); human = () => formatComments(issue); }
    else if (command === "dep") { const result = await service.dep(args); if (Array.isArray(result)) { value = result; human = () => formatDepList(result, args.positionals[2] ?? args.positionals[1] ?? "", stringFlag(args, "direction") ?? "down"); } else { const issue = result as Issue; value = issueWire(issue); human = () => confirmation("Dependency updated", issue); } }
    else if (command === "note") { const body = args.positionals.slice(2).join(" ") || fail("note requires text"); const issue = await service.note(args, body); value = issueWire(issue); human = () => confirmation("Note added to", issue); }
    else if (command === "assign") { const user = args.positionals[2] ?? fail("assign requires user"); const issue = await service.fieldPatch(args, "assignee", user); value = issueWire(issue); human = () => confirmation(`Assigned to ${user}`, issue); }
    else if (command === "priority") { const level = args.positionals[2] ?? fail("priority requires 0-4"); if (!/^[0-4]$/.test(level)) fail(`invalid priority: ${level} (expected 0-4)`); const issue = await service.fieldPatch(args, "priority", issuePriority(Number(level))); value = issueWire(issue); human = () => confirmation(`Priority P${level} set on`, issue); }
    else if (command === "tag") { const labelValue = args.positionals[2] ?? fail("tag requires label"); const issue = await service.tag(args, labelValue); value = issueWire(issue); human = () => confirmation(`Tagged #${labelValue} on`, issue); }
    else if (command === "delete" || command === "remove") { const removed = await service.remove(args); value = { deleted: [...removed] }; human = () => green(`✓ Deleted ${removed.length} issue(s): `) + removed.map((id) => cyan(id)).join(", "); }
    else if (command === "rename") { const renamed = await service.rename(args); value = renamed; human = () => green("✓ Renamed ") + cyan(renamed.from) + " → " + cyan(renamed.to); }
    else if (command === "children") { const kids = await service.children(args); value = kids.map(issueWire); human = () => kids.length === 0 ? dim("No children") : formatList(kids); }
    else if (command === "epic") { const view = await service.epic(args); value = { epic: issueWire(view.epic), children: view.children.map(issueWire), closed: view.done, total: view.children.length, eligible_for_closure: view.eligible }; human = () => formatEpic(view); }
    else if (command === "graph") { const all = await service.all(); const rootId = args.positionals[1]; value = { nodes: all.map(issueWire), edges: all.flatMap((issue) => issue.dependencies.map((edge) => ({ from: issue.id, to: edge.target, type: edge.type }))) }; human = () => formatGraph(all, rootId); }
    else if (command === "stale") { const days = Number(stringFlag(args, "days") ?? 14); const cutoff = new Date(Date.now() - days * 86_400_000); const staleIssues = (await service.all()).filter((issue) => issue.status !== "closed" && issue.updatedAt < cutoff); value = staleIssues.map(issueWire); human = () => formatStale(staleIssues, days); }
    else if (command === "orphans") { const orphans = (await service.all()).filter((issue) => issue.status !== "closed" && issue.assignee === null && issue.labels.length === 0 && issue.dependencies.length === 0 && issue.parentId === null); value = orphans.map(issueWire); human = () => formatOrphans(orphans); }
    else if (command === "duplicates" || command === "find-duplicates") { const all = await service.all(); const open = all.filter((issue) => issue.status !== "closed"); const pairs: Array<readonly [Issue, Issue, number]> = []; const tokenize = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 3)); const bags = open.map((issue) => ({ issue, tokens: tokenize(`${issue.title} ${issue.description}`) })); for (let a = 0; a < bags.length; a += 1) for (let b = a + 1; b < bags.length; b += 1) { const left = bags[a]!.tokens; const right = bags[b]!.tokens; if (left.size === 0 || right.size === 0) continue; const overlap = [...left].filter((token) => right.has(token)).length; const score = overlap / Math.max(left.size, right.size); if (score >= 0.5) pairs.push([bags[a]!.issue, bags[b]!.issue, score]); } pairs.sort((x, y) => y[2] - x[2]); value = pairs.map(([a, b, score]) => ({ a: issueWire(a), b: issueWire(b), similarity: score })); human = () => formatDuplicates(pairs); }
    else if (command === "link") { const issue = await service.link(args); value = issueWire(issue); human = () => confirmation("Linked", issue); }
    else if (command === "duplicate") { const issue = await service.markDuplicate(args); const of = stringFlag(args, "of") ?? ""; value = issueWire(issue); human = () => confirmation(`Marked duplicate of ${of}`, issue); }
    else if (command === "supersede") { const issue = await service.markSuperseded(args); const withId = stringFlag(args, "with") ?? ""; value = issueWire(issue); human = () => confirmation(`Marked superseded by ${withId}`, issue); }
    else if (command === "todo") {
      const sub = args.positionals[1];
      if (sub === "add") { const issue = await service.todoAdd(args); value = issueWire(issue); human = () => confirmation("Added TODO", issue); }
      else if (sub === "done") { const issues = await service.todoDone(args); value = issues.map(issueWire); human = () => issues.map((issue) => confirmation("Closed", issue)).join("\n"); }
      else { const issues = await service.todoList(sub === "list" && booleanFlag(args, "all")); value = issues.map(issueWire); human = () => formatTodo(issues); }
    }
    else if (command === "lint") { const results = await service.lint(args); value = results.map(({ issue, missing }) => ({ id: issue.id, title: issue.title, type: issue.type, missing: missing.map((section) => `## ${section}`), warnings: missing.length })); human = () => formatLint(results); }
    else if (command === "backup") { const info = await service.backup(args); value = info; human = () => formatBackup(info); }
    else if (command === "rename-prefix") { const result = await service.renamePrefix(args); value = result; human = () => formatRenamePrefix(result); }
    else if (command === "version") { value = { version: "0.1.0", service: "tk" }; human = () => formatVersion(); }
    else if (command === "quickstart") { value = { text: QUICKSTART }; human = () => QUICKSTART; }
    else if (command === "prime") { value = { text: PRIME }; human = () => PRIME; }
    else if (command === "onboard") { value = { text: ONBOARD }; human = () => ONBOARD; }
    else if (command === "human") { value = { text: HUMAN_HELP }; human = () => HUMAN_HELP; }
    else if (["update", "close", "reopen", "defer", "undefer", "label", "set-state"].includes(command)) { const issue = await service.mutate(args, command); value = issueWire(issue); const verbs: Readonly<Record<string, string>> = { update: "Updated issue", close: "Closed", reopen: "Reopened", defer: "Deferred", undefer: "Restored", label: "Labels updated on", "set-state": "State changed on" }; human = () => confirmation(verbs[command] ?? "Updated", issue, command === "close" && stringFlag(args, "reason") !== undefined ? `: ${stringFlag(args, "reason")}` : ""); }
    else if (command === "hunk") { const result = await service.hunk(args); value = result.value; human = result.human; }
    else fail(`unknown command: ${command}`);
    if (command === "export" && !json) for (const record of value as readonly unknown[]) console.log(JSON.stringify(record)); else if (!json && human !== null) console.log(human()); else output(value, json); } finally { await storage.close(); } }
main().catch((error: unknown) => { const message = error instanceof Error ? error.message : String(error); if (process.argv.includes("--json")) { const kind: JsonError["error"]["kind"] = error instanceof ArgumentParseError ? "parse" : message.startsWith("readonly") ? "readonly" : message.includes("invalid") || message.startsWith("import line") ? "validation" : "runtime"; console.error(JSON.stringify({ error: { kind, message } } satisfies JsonError)); } else console.error(formatError(message)); exit(1); });
