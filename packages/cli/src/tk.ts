#!/usr/bin/env bun
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { cwd, exit, stdin } from "node:process";
import { dirname, join, resolve } from "node:path";
import { SqliteAdapter } from "@tasks/sqlite";
import { findBeadsWorkspace, inferPrefix, migrateBeadsJsonl, resolveBeadsJsonl, searchPath, type MigrationSummary } from "@tasks/beads";
import { dependencyTarget, issueDescription, issueFromBdWire, issueId, issuePriority, issueTitle, issueToBdWire, type Issue, type IssueId, type Metadata } from "@tasks/domain";
import { canonicalTimestampCodec, err, ok, type IssueUnitOfWork, type Result } from "@tasks/application";
import { booleanFlag, directory, parseArgs, stringFlag, ArgumentParseError, type ParsedArgs } from "./args.js";
import { commentWire, issueWire, output } from "./presentation.js";

const writers = new Set(["init", "create", "update", "close", "reopen", "defer", "undefer", "comment", "dep", "label", "set-state", "import", "migrate"]);
/** Stable stderr JSON error contract: { error: { kind, message } }. */
type JsonError = { readonly error: { readonly kind: "parse" | "validation" | "readonly" | "runtime"; readonly message: string } };
type Config = { readonly prefix?: string };
const fail = (message: string): never => { throw new Error(message); };
const unwrap = <T, E>(result: Result<T, E>): T => { if (result.ok) return result.value; const error = result.error; const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : JSON.stringify(error); return fail(message); };
/** Bun.stdin reads both pipes and file redirects; async-iterating `stdin` misses redirects. */
const readInput = async (): Promise<string> => (await Bun.stdin.text()).trimEnd();
const timeFrom = (value: unknown, fallback: Date): Date => { const parsed = new Date(String(value)); return Number.isNaN(parsed.valueOf()) ? fallback : parsed; };
const parseDate = (value: string | undefined): Date | null | undefined => { if (value === undefined) return undefined; if (value === "" || value === "null") return null; const date = new Date(value); if (Number.isNaN(date.valueOf())) fail(`invalid date: ${value}`); return date; };
const parseMetadata = (value: string | undefined): Metadata | undefined => { if (value === undefined) return undefined; const parsed: unknown = JSON.parse(value); if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") fail("metadata must be JSON object"); return parsed as Metadata; };
const metadataEntry = (value: string): readonly [string, Metadata[string]] => { const separator = value.indexOf("="); if (separator <= 0) fail("metadata entry must be key=value"); const key = value.slice(0, separator); const raw = value.slice(separator + 1); try { return [key, JSON.parse(raw) as Metadata[string]]; } catch { return [key, raw]; } };
/** Only `.tasks/` is a tasks workspace; a `.beads/` directory is a migration source, not a root. */
async function rootFrom(from: string): Promise<string | null> { for (const path of await searchPath(from)) { try { await access(join(path, ".tasks")); return path; } catch { /* keep searching */ } } return null; }
/**
 * Beads workspaces are never renamed or moved: beads keeps its issues in an
 * embedded Dolt database that only `bd` can read, so moving `.beads/` breaks
 * `bd` without migrating a single issue. Migration is explicit (`tk migrate`)
 * and leaves the source untouched.
 */
async function beadsHint(from: string): Promise<string> { const found = await findBeadsWorkspace(from); return found === null ? "no .tasks workspace found; run tk init" : `no .tasks workspace found; found beads data at ${found.directory} — run 'tk migrate' to import it, or 'tk init' for an empty workspace`; }
const get = async (uow: IssueUnitOfWork, raw: string): Promise<Issue> => { const issue = unwrap(await uow.findById(issueId(raw))); return issue ?? fail(`issue not found: ${raw}`); };
const transaction = async <T>(database: SqliteAdapter, work: (uow: IssueUnitOfWork) => Promise<T>): Promise<T> => unwrap(await database.withinTransaction(async (uow) => { try { return ok(await work(uow)); } catch (cause) { return err({ kind: "repository", operation: "cli", cause }); } }));
const changed = (issue: Issue, patch: Partial<Issue>): Issue => ({ ...issue, ...patch, updatedAt: new Date() });

class CommandService {
  constructor(private readonly database: SqliteAdapter, private readonly root: string, private readonly config: Config, private readonly actor: string) {}
  private async currentId(): Promise<string> { const value = await readFile(join(this.root, ".tasks", "current"), "utf8").catch(() => ""); return value.trim() || fail("no current issue selected"); }
  private async selected(args: ParsedArgs): Promise<string> { return args.positionals[1] ?? (booleanFlag(args, "current") ? this.currentId() : fail("issue id required")); }
  private async setCurrent(id: IssueId): Promise<void> { await writeFile(join(this.root, ".tasks", "current"), `${id}\n`); }
  private prefix(): string { return this.config.prefix ?? "tk"; }
  async create(args: ParsedArgs): Promise<Issue> {
    const title = stringFlag(args, "title") ?? args.positionals[1] ?? fail("create requires title"); let description = stringFlag(args, "description") ?? ""; if (booleanFlag(args, "stdin")) description = await readInput();
    return transaction(this.database, async (uow) => {
      const page = unwrap(await uow.list({ limit: 100_000 })); let number = 1; while (page.items.some((issue) => issue.id === `${this.prefix()}-${number}`)) number += 1;
      const now = new Date(); const parent = stringFlag(args, "parent"); const estimate = stringFlag(args, "estimate");
      const issue: Issue = { id: issueId(`${this.prefix()}-${number}`), title: issueTitle(title), description: issueDescription(description), status: stringFlag(args, "status") ?? "open", priority: issuePriority(Number(stringFlag(args, "priority") ?? 2)), type: stringFlag(args, "type") ?? "task", owner: stringFlag(args, "owner") ?? null, assignee: stringFlag(args, "assignee") ?? null, createdBy: this.actor, createdAt: now, updatedAt: now, startedAt: null, closedAt: null, dueAt: parseDate(stringFlag(args, "due")) ?? null, deferUntil: parseDate(stringFlag(args, "defer-until")) ?? null, parentId: parent === undefined ? null : issueId(parent), labels: (stringFlag(args, "labels") ?? stringFlag(args, "label") ?? "").split(",").filter(Boolean), notes: stringFlag(args, "notes") ?? null, design: stringFlag(args, "design") ?? null, acceptanceCriteria: stringFlag(args, "acceptance") ?? null, estimate: estimate === undefined ? null : Number(estimate), specId: stringFlag(args, "spec-id") ?? null, externalRef: stringFlag(args, "external-ref") ?? null, metadata: parseMetadata(stringFlag(args, "metadata")) ?? {}, wireUnknown: {}, dependencies: [], dependencyCount: 0, dependentCount: 0, comments: [], commentCount: 0 };
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
    const configPath = join(this.root, ".tasks", "config.json");
    const current = JSON.parse(await readFile(configPath, "utf8").catch(() => "{}")) as Config;
    if (current.prefix === adopted) return report;
    await writeFile(configPath, JSON.stringify({ ...current, prefix: adopted }, null, 2) + "\n");
    return { ...report, prefix: adopted };
  }
  async list(args: ParsedArgs, ready: boolean): Promise<readonly Issue[]> { return transaction(this.database, async (uow) => { const query = stringFlag(args, "status"); const page = unwrap(await uow.list({ ...(query === undefined ? {} : { status: query }), limit: Number(stringFlag(args, "limit") ?? 1000) })); let items = page.items.filter((issue) => (stringFlag(args, "parent") === undefined || issue.parentId === stringFlag(args, "parent")) && (stringFlag(args, "assignee") === undefined || issue.assignee === stringFlag(args, "assignee")) && (stringFlag(args, "type") === undefined || issue.type === stringFlag(args, "type")) && (stringFlag(args, "priority") === undefined || issue.priority === Number(stringFlag(args, "priority"))) && (stringFlag(args, "label") === undefined || issue.labels.includes(stringFlag(args, "label")!)));
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
    else if (command === "update") { const fields: ReadonlyArray<readonly [string, keyof Issue, (value: string) => Issue[keyof Issue]]> = [["title", "title", issueTitle], ["description", "description", issueDescription], ["priority", "priority", (value) => issuePriority(Number(value))], ["type", "type", (value) => value], ["assignee", "assignee", (value) => value === "" ? null : value], ["owner", "owner", (value) => value], ["acceptance", "acceptanceCriteria", (value) => value], ["design", "design", (value) => value], ["spec-id", "specId", (value) => value], ["estimate", "estimate", (value) => Number(value)], ["external-ref", "externalRef", (value) => value === "" ? null : value], ["parent", "parentId", (value) => value === "" ? null : issueId(value)]]; for (const [flagName, key, convert] of fields) { const value = stringFlag(args, flagName); if (value !== undefined) patch = { ...patch, [key]: convert(value) }; } const status = stringFlag(args, "status"); if (status !== undefined) patch = { ...patch, status }; const due = parseDate(stringFlag(args, "due")); if (due !== undefined) patch = { ...patch, dueAt: due }; const defer = parseDate(stringFlag(args, "defer-until")); if (defer !== undefined) patch = { ...patch, deferUntil: defer }; const metadata = parseMetadata(stringFlag(args, "metadata")); if (metadata !== undefined) patch = { ...patch, metadata }; const setMetadata = stringFlag(args, "set-metadata"); if (setMetadata !== undefined) { const [key, value] = metadataEntry(setMetadata); patch = { ...patch, metadata: { ...issue.metadata, ...(patch.metadata ?? {}), [key]: value } }; } const unsetMetadata = stringFlag(args, "unset-metadata"); if (unsetMetadata !== undefined) { const next = { ...issue.metadata, ...(patch.metadata ?? {}) }; delete next[unsetMetadata]; patch = { ...patch, metadata: next }; } const labels = stringFlag(args, "label"); if (labels !== undefined) patch = { ...patch, labels: [...new Set([...issue.labels, ...labels.split(",")])] }; const addLabel = stringFlag(args, "add-label"); if (addLabel !== undefined) patch = { ...patch, labels: [...new Set([...(patch.labels ?? issue.labels), ...addLabel.split(",").filter(Boolean)])] }; const removeLabel = stringFlag(args, "remove-label"); if (removeLabel !== undefined) { const removed = new Set(removeLabel.split(",")); patch = { ...patch, labels: (patch.labels ?? issue.labels).filter((label) => !removed.has(label)) }; } let body = stringFlag(args, "body"); if (booleanFlag(args, "stdin")) body = await readInput(); if (body !== undefined) patch = { ...patch, description: issueDescription(body) }; const notes = stringFlag(args, "append-notes"); if (notes !== undefined) patch = { ...patch, notes: [issue.notes, notes].filter(Boolean).join("\n") }; } else fail(`unknown command: ${command}`);
    const result = changed(issue, patch); unwrap(await uow.save(result)); if (command === "close" || command === "reopen" || command === "set-state") await this.setCurrent(result.id); return result; }); }
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

const queryIssues = (items: readonly Issue[], expression: string): readonly Issue[] => {
  const match = expression.trim().match(/^([a-z_]+)\s*(=|!=|~)\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_.-]+))$/i);
  if (!match) fail("invalid query: supported fields are id, status, type, priority, assignee, owner, label, title; operators =, !=, ~");
  const valid = match!; const [, field, operator, quotedDouble, quotedSingle, bare] = valid; const value = quotedDouble ?? quotedSingle ?? bare ?? "";
  const values = (issue: Issue): readonly string[] => { switch (field!) { case "id": return [issue.id]; case "status": return [issue.status]; case "type": return [issue.type]; case "priority": return [String(issue.priority)]; case "assignee": return [issue.assignee ?? ""]; case "owner": return [issue.owner ?? ""]; case "label": return issue.labels; case "title": return [issue.title]; default: return fail(`invalid query field: ${field}`); } };
  return items.filter((issue) => { const candidate = values(issue); return operator === "=" ? candidate.includes(value) : operator === "!=" ? !candidate.includes(value) : candidate.some((entry) => entry.toLowerCase().includes(value.toLowerCase())); });
};

const HELP = `tk - Task Tracker

USAGE
  tk <command> [options]

COMMANDS
  init [--prefix <p>]       Initialize .tasks/ workspace
  create <title> [opts]     Create issue
  show <id>                 Show issue details
  list [--status <s>]       List issues
  ready [--claim]           List ready (unblocked) issues
  update <id> [--field val] Update issue fields
  close <id>                Close issue
  reopen <id>               Reopen closed issue
  comment <id> <body>       Add comment
  dep <id> add|rm <target>  Manage dependencies
  search <text>             Full-text search
  query <expr>              Structured query
  history <id>              Show audit history
  export                    Export all issues as JSONL
  import                    Import JSONL from stdin
  migrate [--dry-run]       Migrate a beads workspace into .tasks/
  blocked                   List blocked issues
  count                     Summary counts
  where                     Show workspace paths
  doctor                    Health check

GLOBAL FLAGS
  --json                    Output as JSON
  --readonly                Reject writes
  --dir <path>              Override workspace root
  --actor <name>            Override actor identity
  -h, --help                Show this help
`;
async function main(): Promise<void> { const args = parseArgs(process.argv.slice(2)); const command = args.positionals[0] ?? "help"; const json = booleanFlag(args, "json"); const start = directory(args, cwd()); let root = await rootFrom(start);
  if (command === "help" || booleanFlag(args, "help") || booleanFlag(args, "h")) { process.stdout.write(HELP); return; }
  if (command === "init") { if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes"); const initRoot = start; root = initRoot; const prefix = stringFlag(args, "prefix") ?? "tk"; await mkdir(join(initRoot, ".tasks"), { recursive: true }); await writeFile(join(initRoot, ".tasks", "config.json"), JSON.stringify({ prefix }, null, 2) + "\n"); const database = new SqliteAdapter({ filename: join(initRoot, ".tasks", "tasks.db") }); try { unwrap(await database.migrate()); } finally { database.close(); } output({ workspace: initRoot, prefix, initialized: true }, json); return; }
  // migrate bootstraps its own workspace so a beads-only checkout needs no separate init,
  // except under --dry-run, which must leave the filesystem untouched.
  const bootstrapping = root === null && command === "migrate";
  const ephemeral = bootstrapping && booleanFlag(args, "dry-run");
  if (bootstrapping) { if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes"); if (!ephemeral) { await mkdir(join(start, ".tasks"), { recursive: true }); await writeFile(join(start, ".tasks", "config.json"), JSON.stringify({ prefix: stringFlag(args, "prefix") ?? "tk" }, null, 2) + "\n"); } root = start; }
  if (root === null) fail(await beadsHint(start)); const workspace = root!; const tasksDir = join(workspace, '.tasks');
  const config = JSON.parse(await readFile(join(tasksDir, "config.json"), "utf8").catch(() => "{}")) as Config; if (booleanFlag(args, "readonly") && writers.has(command)) fail("readonly mode blocks writes"); if (command === "where") { output({ path: tasksDir, workspace, database_path: join(tasksDir, "tasks.db"), database: join(tasksDir, "tasks.db"), prefix: config.prefix ?? "tk", schema_version: 1 }, json); return; }
  const readonly = booleanFlag(args, "readonly");
  const database = new SqliteAdapter({ filename: ephemeral ? ":memory:" : join(tasksDir, "tasks.db"), readonly }); try { if (readonly) { if (unwrap(await database.hasPendingMigrations())) fail("readonly mode requires current database; pending migrations detected"); } else unwrap(await database.migrate()); const service = new CommandService(database, workspace, config, stringFlag(args, "actor") ?? process.env["USER"] ?? "unknown"); let value: unknown; if (command === "create") value = issueWire(await service.create(args)); else if (command === "show") value = [issueWire(await service.show(args))]; else if (command === "list" || command === "ready") value = (await service.list(args, command === "ready")).map(issueWire); else if (command === "blocked") { const all = await service.all(); value = all.filter((issue) => issue.dependencies.some((edge) => edge.type === "blocks" && all.some((other) => other.id === edge.target && other.status !== "closed"))).map(issueWire); } else if (command === "count") { const all = await service.all(); value = { total: all.length, by_status: Object.fromEntries([...new Set(all.map((issue) => issue.status))].sort().map((status) => [status, all.filter((issue) => issue.status === status).length])), by_type: Object.fromEntries([...new Set(all.map((issue) => issue.type))].sort().map((type) => [type, all.filter((issue) => issue.type === type).length])) }; } else if (command === "status") { const all = await service.all(); value = Object.fromEntries([...new Set(all.map((issue) => issue.status))].sort().map((status) => [status, all.filter((issue) => issue.status === status).length])); } else if (command === "query") { const expression = args.positionals.slice(1).join(" ") || fail("query requires expression"); value = queryIssues(await service.all(), expression).map(issueWire); } else if (command === "search") { const text = args.positionals.slice(1).join(" ").trim() || fail("search requires text"); const needle = text.toLowerCase(); value = (await service.all()).filter((issue) => [issue.id, issue.title, issue.description, issue.notes ?? "", ...issue.labels].join("\n").toLowerCase().includes(needle)).map(issueWire); } else if (command === "history") value = await service.history(args); else if (command === "types") value = [...new Set((await service.all()).map((issue) => issue.type))].sort(); else if (command === "statuses") value = [...new Set(["open", "in_progress", "closed", ...(await service.all()).map((issue) => issue.status)])].sort(); else if (command === "export") value = (await service.all()).map((issue) => issueToBdWire({ version: 1, issue, unknown: issue.wireUnknown }, canonicalTimestampCodec)); else if (command === "import") { const count = await service.importJsonl(await readInput()); value = { imported: count }; } else if (command === "migrate") value = await service.migrate(args); else if (command === "doctor") { const all = await service.all(); value = { ok: true, database: join(tasksDir, "tasks.db"), schema_version: 2, issues: all.length }; } else if (command === "ping") value = { ok: true, service: "tasks", schema_version: 2 }; else if (command === "comment") value = issueWire(await service.comment(args)); else if (command === "comments") value = commentWire(await service.comments(args)); else if (command === "dep") { const result = await service.dep(args); value = Array.isArray(result) ? result : issueWire(result as Issue); } else if (["update", "close", "reopen", "defer", "undefer", "label", "set-state"].includes(command)) value = issueWire(await service.mutate(args, command)); else fail(`unknown command: ${command}`); if (command === "export" && !json) for (const record of value as readonly unknown[]) console.log(JSON.stringify(record)); else output(value, json); } finally { database.close(); } }
main().catch((error: unknown) => { const message = error instanceof Error ? error.message : String(error); if (process.argv.includes("--json")) { const kind: JsonError["error"]["kind"] = error instanceof ArgumentParseError ? "parse" : message.startsWith("readonly") ? "readonly" : message.includes("invalid") || message.startsWith("import line") ? "validation" : "runtime"; console.error(JSON.stringify({ error: { kind, message } } satisfies JsonError)); } else console.error(message); exit(1); });
