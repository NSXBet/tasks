import type { Issue } from "@tasks/domain";

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

/* ------------------------------------------------------------------ */
/* Color layer — zero-dependency ANSI, disabled when not a TTY or      */
/* NO_COLOR is set (https://no-color.org).                             */
/* ------------------------------------------------------------------ */

const paint = process.stdout.isTTY && !process.env["NO_COLOR"];
const wrap = (code: string) => (text: string): string => (paint ? `${code}${text}[0m` : text);
export const bold = wrap("[1m");
export const dim = wrap("[2m");
export const italic = wrap("[3m");
export const red = wrap("[31m");
export const green = wrap("[32m");
export const yellow = wrap("[33m");
export const blue = wrap("[34m");
export const magenta = wrap("[35m");
export const cyan = wrap("[36m");
export const white = wrap("[37m");

/* ------------------------------------------------------------------ */
/* Icons — mirrors bd's status legend.                                 */
/* ------------------------------------------------------------------ */

const STATUS_ICON: Readonly<Record<string, string>> = {
  open: "○",
  in_progress: "◐",
  blocked: "●",
  deferred: "❄",
  closed: "✓",
  pinned: "📌",
  hooked: "◇",
};
const statusIcon = (status: string): string => STATUS_ICON[status] ?? "○";
const statusColored = (status: string): string => {
  const icon = statusIcon(status);
  if (status === "closed") return green(icon);
  if (status === "in_progress") return yellow(icon);
  if (status === "blocked") return red(icon);
  if (status === "deferred") return cyan(icon);
  return icon;
};

const PRIORITY_COLOR: ReadonlyArray<(text: string) => string> = [red, red, yellow, white, dim];
export const priorityBadge = (priority: number): string => {
  const label = `● P${priority}`;
  return (PRIORITY_COLOR[Math.min(Math.max(priority, 0), 4)] ?? white)(label);
};

const TYPE_COLOR: Readonly<Record<string, (text: string) => string>> = {
  bug: red, epic: magenta, feature: cyan, chore: dim, task: blue,
};
export const typeBadge = (type: string): string => (TYPE_COLOR[type] ?? blue)(`[${type}]`);

export const statusLabel = (status: string): string => {
  const upper = status.toUpperCase();
  if (status === "closed") return green(upper);
  if (status === "in_progress") return yellow(upper);
  if (status === "blocked") return red(upper);
  if (status === "deferred") return cyan(upper);
  return white(upper);
};

/* ------------------------------------------------------------------ */
/* Wire format — unchanged JSON contract.                              */
/* ------------------------------------------------------------------ */

export function issueWire(issue: Issue): Record<string, unknown> {
  return {
    schema_version: 1, _type: "issue", id: issue.id, title: issue.title, description: issue.description,
    status: issue.status, priority: issue.priority, issue_type: issue.type, owner: issue.owner,
    assignee: issue.assignee, created_by: issue.createdBy, created_at: issue.createdAt.toISOString(),
    updated_at: issue.updatedAt.toISOString(), started_at: iso(issue.startedAt), closed_at: iso(issue.closedAt),
    due_at: iso(issue.dueAt), defer_until: iso(issue.deferUntil), parent: issue.parentId, labels: [...issue.labels],
    notes: issue.notes, design: issue.design, acceptance_criteria: issue.acceptanceCriteria, estimated_minutes: issue.estimate,
    spec_id: issue.specId, external_ref: issue.externalRef, metadata: issue.metadata,
    dependencies: issue.dependencies.map((edge) => ({ issue_id: edge.issueId, depends_on_id: edge.target, type: edge.type, created_at: edge.createdAt.toISOString(), created_by: edge.createdBy, metadata: edge.metadata })),
    dependency_count: issue.dependencyCount, dependent_count: issue.dependentCount,
    comments: issue.comments.map((comment) => ({ id: comment.id, issue_id: comment.issueId, author: comment.author, text: comment.text, created_at: comment.createdAt.toISOString() })),
    comment_count: issue.commentCount,
  };
}
export function commentWire(issue: Issue): readonly Record<string, unknown>[] { return issueWire(issue)["comments"] as readonly Record<string, unknown>[]; }

/* ------------------------------------------------------------------ */
/* Human formatters — colored, icon-first, bd-style.                   */
/* ------------------------------------------------------------------ */

const date = (value: Date | null): string => (value === null ? "" : value.toISOString().slice(0, 10));
const datetime = (value: Date): string => value.toISOString().slice(0, 16).replace("T", " ");
const RULE = dim("─".repeat(80));
export const LEGEND = dim(`Status: ${statusIcon("open")} open  ${statusIcon("in_progress")} in_progress  ${statusIcon("blocked")} blocked  ${statusIcon("closed")} closed  ${statusIcon("deferred")} deferred`);

const indent = (text: string, pad = "  "): string => text.split("\n").map((line) => (line === "" ? "" : pad + line)).join("\n");
const field = (name: string, value: string): string => `${dim(name.padEnd(12))} ${value}`;

/** One issue per line: icon + id + priority + [type] + title, with summary + legend. */
function formatIssueList(issues: readonly Issue[], summary: (issues: readonly Issue[]) => string): string {
  const lines = issues.map((issue) => {
    const type = issue.type === "task" ? "" : ` ${typeBadge(issue.type)}`;
    const labels = issue.labels.length === 0 ? "" : dim(`  ${issue.labels.map((label) => `#${label}`).join(" ")}`);
    return `${statusColored(issue.status)} ${cyan(issue.id)} ${priorityBadge(issue.priority)}${type} ${issue.title}${labels}`;
  });
  return [...lines, "", RULE, summary(issues), "", LEGEND].join("\n");
}

export function formatList(issues: readonly Issue[]): string {
  return formatIssueList(issues, (items) => {
    const open = items.filter((issue) => issue.status === "open").length;
    const wip = items.filter((issue) => issue.status === "in_progress").length;
    return `Total: ${items.length} issues (${open} open, ${wip} in progress)`;
  });
}

export function formatReady(issues: readonly Issue[]): string {
  if (issues.length === 0) return `${yellow("No ready issues")} — everything is blocked or in progress`;
  return formatIssueList(issues, (items) => green(`Ready: ${items.length} issues with no active blockers`));
}

export function formatBlocked(issues: readonly Issue[], all: readonly Issue[]): string {
  if (issues.length === 0) return green("No blocked issues 🎉");
  const lines = issues.map((issue) => {
    const blockers = issue.dependencies
      .filter((edge) => edge.type === "blocks")
      .map((edge) => all.find((other) => other.id === edge.target))
      .filter((other): other is Issue => other !== undefined && other.status !== "closed");
    const head = `${statusColored("blocked")} ${priorityBadge(issue.priority)} ${cyan(issue.id)}: ${issue.title}`;
    return blockers.length === 0 ? head : `${head}\n${dim(`  Blocked by ${blockers.length} open dependencies: [${blockers.map((other) => other.id).join(", ")}]`)}`;
  });
  return [`🚫 ${bold(red(`Blocked issues (${issues.length})`))}:`, "", ...lines].join("\n");
}

function formatSection(title: string, body: string): string {
  return `${bold(title)}\n${indent(body)}`;
}

export function formatShow(issue: Issue): string {
  const head = `${statusColored(issue.status)} ${cyan(issue.id)} · ${bold(issue.title)}   [${priorityBadge(issue.priority)} · ${statusLabel(issue.status)}]`;
  const meta = [issue.owner === null ? null : `Owner: ${issue.owner}`, issue.assignee === null ? null : `Assignee: ${issue.assignee}`, `Type: ${issue.type}`, issue.estimate === null ? null : `Estimate: ${issue.estimate}m`].filter(Boolean).join(" · ");
  const dates = [field("Created:", date(issue.createdAt)), issue.startedAt === null ? null : field("Started:", date(issue.startedAt)), field("Updated:", date(issue.updatedAt)), issue.closedAt === null ? null : field("Closed:", date(issue.closedAt)), issue.dueAt === null ? null : field("Due:", date(issue.dueAt)), issue.deferUntil === null ? null : field("Deferred:", date(issue.deferUntil))].filter(Boolean).join("  ");
  const sections: string[] = [head, dim(meta), dim(dates)];
  sections.push(formatSection("DESCRIPTION", issue.description.trim() === "" ? dim("(none)") : issue.description.trimEnd()));
  if (issue.labels.length > 0) sections.push(`${bold("LABELS:")} ${issue.labels.map((label) => magenta(`#${label}`)).join(" ")}`);
  if (issue.design !== null) sections.push(formatSection("DESIGN", issue.design.trimEnd()));
  if (issue.acceptanceCriteria !== null) sections.push(formatSection("ACCEPTANCE CRITERIA", issue.acceptanceCriteria.trimEnd()));
  if (issue.notes !== null) sections.push(formatSection("NOTES", issue.notes.trimEnd()));
  if (issue.dependencies.length > 0) sections.push(formatSection("DEPENDENCIES", issue.dependencies.map((edge) => `→ ${cyan(edge.target)} (${edge.type})`).join("\n")));
  if (issue.parentId !== null) sections.push(`${bold("PARENT:")} ${cyan(issue.parentId)}`);
  if (issue.comments.length > 0) sections.push(formatSection(`COMMENTS (${issue.comments.length})`, issue.comments.map((comment) => `${dim(datetime(comment.createdAt))} ${green(comment.author)}\n${indent(comment.text.trimEnd())}`).join("\n\n")));
  return sections.join("\n\n");
}

export function formatComments(issue: Issue): string {
  if (issue.comments.length === 0) return dim(`No comments on ${issue.id}`);
  return [`${bold(`Comments on ${cyan(issue.id)}:`)}`, "", ...issue.comments.map((comment) => `${green(`[${comment.author}]`)} ${dim(`at ${datetime(comment.createdAt)}`)}\n${indent(comment.text.trimEnd())}`)].join("\n");
}

/** bd-style mutation confirmations. */
export const confirmation = (verb: string, issue: Issue, extra = ""): string =>
  green(`✓ ${verb} `) + cyan(issue.id) + ` — ${issue.title}${extra}`;

export function formatHistory(entries: readonly Record<string, unknown>[], id: string): string {
  if (entries.length === 0) return dim(`No history for ${id}`);
  const lines = entries.map((entry) => {
    const at = String(entry["at"]).slice(0, 19).replace("T", " ");
    return `${dim(String(entry["id"]).slice(0, 8))} ${dim(at)}\n  ${dim("Action:")} ${yellow(String(entry["action"]))}  ${dim("Actor:")} ${entry["actor"]}`;
  });
  return [`📜 ${bold(`History for ${cyan(id)}`)} ${dim(`(${entries.length} entries)`)}`, ...lines].join("\n\n");
}

export function formatCount(count: { readonly total: number; readonly by_status: Record<string, number>; readonly by_type: Record<string, number> }): string {
  const rows = (entries: Record<string, number>): string[] => Object.entries(entries).map(([key, value]) => field(`${key}:`, String(value)));
  return [`📊 ${bold("Issue Counts")}`, "", field("Total:", String(count.total)), "", bold("By status:"), ...rows(count.by_status), "", bold("By type:"), ...rows(count.by_type)].join("\n");
}

export function formatStatus(counts: Record<string, number>): string {
  const lines = Object.entries(counts).map(([status, count]) => `${statusColored(status)} ${field(`${status}:`, String(count))}`);
  return [`📊 ${bold("Issue Database Status")}`, "", ...lines].join("\n");
}

export function formatStats(stats: { readonly total: number; readonly open: number; readonly in_progress: number; readonly blocked: number; readonly closed: number; readonly deferred: number; readonly ready: number }): string {
  const row = (name: string, value: number): string => `  ${name.padEnd(22)}${value}`;
  return ["", `📊 ${bold("Issue Database Status")}`, "", bold("Summary:"), row("Total Issues:", stats.total), row("Open:", stats.open), row("In Progress:", stats.in_progress), row("Blocked:", stats.blocked), row("Closed:", stats.closed), row("Deferred:", stats.deferred), green(row("Ready to Work:", stats.ready)), "", dim("For more details, use 'tk list' to see individual issues.")].join("\n");
}

export function formatTypes(used: readonly string[]): string {
  const core: ReadonlyArray<readonly [string, string]> = [["task", "General work item (default)"], ["bug", "Bug report or defect"], ["feature", "New feature or enhancement"], ["chore", "Maintenance or housekeeping"], ["epic", "Large body of work spanning multiple issues"]];
  const rows = core.map(([type, description]) => `  ${(TYPE_COLOR[type] ?? blue)(type.padEnd(12))} ${dim(description)}`);
  const custom = used.filter((type) => !core.some(([name]) => name === type));
  return [bold("Core work types (built-in):"), ...rows, "", custom.length === 0 ? dim("No custom types in use.") : bold("In use (custom):"), ...custom.map((type) => `  ${typeBadge(type)}`)].join("\n");
}

export function formatStatuses(used: readonly string[]): string {
  const core: ReadonlyArray<readonly [string, string, string]> = [["open", "active", "Available to work (default)"], ["in_progress", "wip", "Actively being worked on"], ["blocked", "wip", "Blocked by a dependency"], ["deferred", "frozen", "Deliberately put on ice for later"], ["closed", "done", "Completed"]];
  const rows = core.map(([status, category, description]) => `  ${statusColored(status!)} ${status!.padEnd(12)} ${dim(`[${(category ?? "").padEnd(6)}]`)} ${dim(description ?? "")}`);
  const custom = used.filter((status) => !core.some(([name]) => name === status));
  return [bold("Built-in statuses:"), ...rows, ...(custom.length === 0 ? [] : ["", bold("In use (custom):"), ...custom.map((status) => `  ${statusColored(status)} ${status}`)])].join("\n");
}

export function formatDepList(entries: readonly Record<string, unknown>[], id: string, direction: string): string {
  if (entries.length === 0) return dim(`${id} has no dependencies${direction === "up" ? " or dependents" : ""}`);
  const lines = entries.map((entry) => `${statusColored(String(entry["status"]))} ${cyan(String(entry["id"]))}: ${entry["title"]}  ${dim(String(entry["dependency_type"]))} ${typeBadge(String(entry["issue_type"]))}`);
  return [`${bold(direction === "up" ? "Dependents of" : "Dependencies of")} ${cyan(id)} ${dim(`(${entries.length})`)}:`, "", ...lines].join("\n");
}

export function formatSearch(issues: readonly Issue[], text: string): string {
  if (issues.length === 0) return `No issues found matching '${text}'`;
  return [`${bold(`${issues.length} issues matching '${text}':`)}`, "", ...issues.map((issue) => `${statusColored(issue.status)} ${cyan(issue.id)} ${priorityBadge(issue.priority)} ${issue.title}`)].join("\n");
}

export function formatMigration(report: Record<string, unknown>): string {
  const dry = report["dry_run"] === true;
  const lines = [
    `${dry ? yellow("Dry run") : green("✓ Migration")} — source: ${String(report["source"])} (${String(report["source_path"])})`,
    field("Read:", String(report["read"])),
    field("Imported:", String(report["imported"])),
    field("Skipped:", String((report["skipped"] as readonly unknown[]).length)),
    field("Overwritten:", String((report["overwritten"] as readonly unknown[]).length)),
  ];
  if (typeof report["prefix"] === "string") lines.push(field("Prefix:", report["prefix"]));
  const carried = (report["carried"] as readonly unknown[]).length;
  if (carried > 0) lines.push(field("Carried:", `${carried} non-issue records`));
  return lines.join("\n");
}

/* ---------------- New bd-parity views ---------------- */

export function formatStale(issues: readonly Issue[], days: number): string {
  if (issues.length === 0) return green(`No issues stale for ${days}+ days`);
  return [`🕰️  ${bold(`Stale issues (${issues.length})`)} — no updates in ${days}+ days`, "", ...issues.map((issue) => `${statusColored(issue.status)} ${priorityBadge(issue.priority)} ${cyan(issue.id)}: ${issue.title}  ${dim(`(updated ${date(issue.updatedAt)})`)}`)].join("\n");
}

export function formatDuplicates(clusters: ReadonlyArray<readonly [Issue, Issue, number]>): string {
  if (clusters.length === 0) return green("No potential duplicates found");
  const lines = clusters.flatMap(([a, b, score]) => [
    `${yellow("≈")} ${cyan(a.id)} ↔ ${cyan(b.id)}  ${dim(`similarity ${(score * 100).toFixed(0)}%`)}`,
    `  ${statusColored(a.status)} ${a.title}`,
    `  ${statusColored(b.status)} ${b.title}`,
  ]);
  return [`🔁 ${bold(`Potential duplicates (${clusters.length} pairs)`)}`, "", ...lines, "", dim("Close or merge with: tk close <loser> --reason 'duplicate of <winner>'")].join("\n");
}

export function formatOrphans(issues: readonly Issue[]): string {
  if (issues.length === 0) return green("No orphaned issues 🎉");
  return [`🏝️  ${bold(`Orphaned issues (${issues.length})`)} — open, unassigned, no labels, no dependencies`, "", ...issues.map((issue) => `${statusColored(issue.status)} ${priorityBadge(issue.priority)} ${cyan(issue.id)}: ${issue.title}  ${dim(`(created ${date(issue.createdAt)})`)}`)].join("\n");
}

/** ASCII dependency tree, bd-graph style: blocker → dependent, colored by status. */
export function formatGraph(all: readonly Issue[], rootId?: string): string {
  /** Roots: no parent and not blocked-by/blocking anything. Children nest under parent/blocker. */
  const hasIncoming = new Set(all.flatMap((issue) => issue.dependencies.filter((edge) => edge.type === "blocks").map((edge) => edge.target as string)));
  const roots = rootId === undefined
    ? all.filter((issue) => issue.parentId === null && !hasIncoming.has(issue.id) && !issue.dependencies.some((edge) => edge.type === "blocks"))
    : all.filter((issue) => issue.id === rootId);
  if (roots.length === 0) return rootId === undefined ? dim("No issues") : `issue not found: ${rootId}`;
  const lines: string[] = [bold("Dependency graph"), ""];
  const seen = new Set<string>();
  const node = (issue: Issue): string => `${statusColored(issue.status)} ${cyan(issue.id)}: ${issue.title}`;
  const walk = (issue: Issue, prefix: string, isRoot: boolean, last: boolean): void => {
    lines.push(prefix + (isRoot ? "" : last ? "└── " : "├── ") + node(issue));
    if (seen.has(issue.id)) { lines[lines.length - 1] += dim(" (↩ cycle)"); return; }
    seen.add(issue.id);
    const kids: Issue[] = [
      ...all.filter((candidate) => candidate.parentId === issue.id),
      ...all.filter((candidate) => candidate.dependencies.some((edge) => edge.type === "blocks" && edge.target === issue.id)),
    ].filter((kid, index, list) => list.findIndex((other) => other.id === kid.id) === index);
    const childPrefix = isRoot ? "" : prefix + (last ? "    " : "│   ");
    kids.forEach((kid, index) => walk(kid, childPrefix, false, index === kids.length - 1));
  };
  roots.forEach((root) => walk(root, "", true, true));
  return [...lines, LEGEND].join("\n");
}

export function formatEpic(view: { readonly epic: Issue; readonly children: readonly Issue[]; readonly done: number; readonly eligible: boolean }): string {
  const { epic, children, done, eligible } = view;
  const pct = children.length === 0 ? 0 : Math.round((done / children.length) * 100);
  const bar = `${green("█".repeat(Math.round(pct / 10)))}${dim("░".repeat(10 - Math.round(pct / 10)))}`;
  const lines = [
    `${statusColored(epic.status)} ${cyan(epic.id)} · ${bold(epic.title)}   ${typeBadge("epic")} ${priorityBadge(epic.priority)}`,
    `  ${bar} ${pct}%  ${dim(`(${done}/${children.length} closed)`)}` + (eligible ? green("  ✓ eligible to close") : ""),
  ];
  if (children.length > 0) lines.push("", ...children.map((child) => `  ${statusColored(child.status)} ${priorityBadge(child.priority)} ${cyan(child.id)}: ${child.title}`));
  return lines.join("\n");
}

export function formatWhere(info: Record<string, unknown>): string {
  return [field("Workspace:", String(info["workspace"])), field("Data dir:", String(info["path"])), field("Backend:", String(info["backend"])), field("Database:", String(info["database"])), field("Prefix:", String(info["prefix"])), field("Schema:", String(info["schema_version"]))].join("\n");
}

export function formatDoctor(report: Record<string, unknown>): string {
  return [green("✓ Healthy"), "", field("Backend:", String(report["backend"])), field("Database:", String(report["database"])), field("Schema:", String(report["schema_version"])), field("Issues:", String(report["issues"]))].join("\n");
}

const worktreeStateIcon = (state: string): string => state === "shared" ? green("●") : state === "redirect" ? cyan("↪") : dim("○");
const worktreeStateLabel = (state: string): string => state === "shared" ? "shared" : state === "redirect" ? "redirect" : "none";

export interface WorktreeRow { readonly name: string; readonly path: string; readonly branch: string | null; readonly tasks: string }
/** `tk worktree list`: one row per git worktree, with tasks-workspace state. */
export function formatWorktreeList(rows: readonly WorktreeRow[]): string {
  if (rows.length === 0) return dim("No worktrees.");
  const nameWidth = Math.max(4, ...rows.map((row) => row.name.length));
  const lines = rows.map((row) => `${worktreeStateIcon(row.tasks)} ${row.name.padEnd(nameWidth)}  ${dim(row.path)}${row.branch === null ? "" : dim(`  [${row.branch}]`)}  ${dim(`(${worktreeStateLabel(row.tasks)})`)}`);
  return [bold(`Worktrees (${rows.length})`), "", ...lines].join("\n");
}

export interface WorktreeInfo { readonly path: string; readonly branch: string | null; readonly tasks: string; readonly tasks_dir: string | null; readonly main_worktree: string }
/** `tk worktree info`: current worktree's tasks-workspace state. */
export function formatWorktreeInfo(info: WorktreeInfo): string {
  const lines = [field("Path:", info.path), field("Branch:", info.branch ?? dim("(detached)")), field("Tasks:", `${worktreeStateIcon(info.tasks)} ${worktreeStateLabel(info.tasks)}`)];
  if (info.tasks_dir !== null) lines.push(field("Tasks dir:", info.tasks_dir));
  if (info.tasks === "redirect") lines.push(field("Main:", info.main_worktree));
  return lines.join("\n");
}

/** `bd lint`: missing recommended markdown sections per issue type. */
export const LINT_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  bug: ["Steps to Reproduce", "Acceptance Criteria"],
  task: ["Acceptance Criteria"],
  feature: ["Acceptance Criteria"],
  epic: ["Success Criteria"],
  chore: [],
};
export function formatLint(results: ReadonlyArray<{ readonly issue: Issue; readonly missing: readonly string[] }>): string {
  if (results.length === 0) return green("✓ No missing sections");
  const lines = results.map(({ issue, missing }) => [
    `${statusColored(issue.status)} ${cyan(issue.id)} ${typeBadge(issue.type)} ${issue.title}`,
    ...missing.map((section) => dim(`  missing: ## ${section}`)),
  ].join("\n"));
  return [bold(`Lint (${results.length} issue(s) with missing sections)`), "", ...lines].join("\n");
}

/** `bd todo`: task-type issues shown as a checklist. */
export function formatTodo(issues: readonly Issue[]): string {
  if (issues.length === 0) return dim("No TODOs");
  const lines = issues.map((issue) => `${issue.status === "closed" ? green("[x]") : dim("[ ]")} ${cyan(issue.id)} ${priorityBadge(issue.priority)} ${issue.title}`);
  return [bold("TODOs"), "", ...lines].join("\n");
}

/** `bd backup`: filesystem copy of the database file. */
export function formatBackup(info: { readonly path: string; readonly bytes: number }): string {
  return `${green("✓ Backed up")} ${field("To:", cyan(info.path))}\n${field("Size:", `${info.bytes} bytes`)}`;
}

/** `bd rename-prefix`: batch id rewrite summary. */
export function formatRenamePrefix(result: { readonly from: readonly string[]; readonly to: string; readonly renamed: number; readonly dryRun: boolean }): string {
  const verb = result.dryRun ? "Would rename" : "Renamed";
  return `${green(`✓ ${verb} ${result.renamed} issue(s)`)} ${dim(`(${result.from.join(", ")} → ${result.to}*)`)}`;
}

export const VERSION = "0.1.0";
export function formatVersion(): string { return `tk version ${VERSION}`; }

export const QUICKSTART = `${bold("tk quickstart")}

${dim("Capture something without thinking about it:")}
  tk q "fix the thing"

${dim("See what's next:")}
  tk ready

${dim("Work an issue end to end:")}
  tk show <id>
  tk update <id> --status in_progress
  tk comment <id> "progress note"
  tk close <id> --reason "done"

${dim("Track relationships:")}
  tk create "epic title" -t epic
  tk create "subtask" --parent <epic-id>
  tk epic <epic-id>

${dim("Keep the board healthy:")}
  tk stale --days 14
  tk duplicates
  tk orphans
  tk lint

Run ${cyan("tk help")} for the full command reference.
`;

export const PRIME = `# tk workflow context

- Issues live in ${cyan(".tasks/")}; the storage backend (file/sqlite/postgres) is set once in ${cyan(".tasks/config.json")} and every mutating command writes through one transaction.
- Use ${cyan("--json")} for machine-readable output; omit it for colored human output.
- IDs are short random hashes (${cyan("<prefix>-xyz")}), not sequential — never assume ordering.
- Typical loop: ${cyan("tk ready")} → ${cyan("tk show <id>")} → ${cyan("tk update <id> --status in_progress")} → ${cyan("tk comment <id> ...")} → ${cyan("tk close <id>")}.
- Use ${cyan("tk dep add <id> <blocker>")} to record blockers; ${cyan("tk graph")} renders the tree; ${cyan("tk stale")}/${cyan("tk orphans")}/${cyan("tk duplicates")}/${cyan("tk lint")} for hygiene.
- Run ${cyan("tk help")} for the full command list.
`;

export const ONBOARD = `## Task tracking

This project uses tk for issue tracking. Run \`tk prime\` for workflow context before starting work.

\`\`\`
tk ready              # Find available work
tk show <id>          # View issue details
tk update <id> --status in_progress
tk close <id>         # Complete work
\`\`\`
`;

/** `bd human`: the ~15 commands people actually type, no agent noise. */
export const HUMAN_HELP = `${bold("tk — essentials")}

  tk create <title>       Create an issue
  tk list                 List issues
  tk show <id>            Show details
  tk update <id> ...      Change fields
  tk close <id>           Close it
  tk comment <id> <text>  Leave a note
  tk ready                What's unblocked
  tk blocked              What's stuck
  tk search <text>        Find something
  tk stats                Board overview

Full list: ${cyan("tk help")}
`;

/** `tk init --help` / `tk help init`: the one command whose flags choose a workspace's storage backend for its whole lifetime. */
export const INIT_HELP = `${bold("tk init")} — initialize a .tasks/ workspace

${dim("Usage:")}
  tk init [--prefix <p>] [--backend file|sqlite|postgres] [--filename <name>] [--url-env <VAR>]

${dim("Flags:")}
  --prefix <p>       ID prefix for new issues (default: tk)
  --backend <name>   Storage backend to write into .tasks/config.json (default: file)
                     one of: ${cyan("file")}, ${cyan("sqlite")}, ${cyan("postgres")}
  --filename <name>  sqlite only — db filename inside .tasks/ (default: tasks.db)
  --url-env <VAR>    postgres only — env var holding the connection string
                     (default: TASKS_DATABASE_URL)

${dim("Backends:")}
  file      One JSON file per issue under .tasks/issues/. Git-friendly, no
            native dependency. Default when --backend is omitted.
  sqlite    Single-file database at .tasks/tasks.db (or --filename).
  postgres  Shared database. The connection string is read from the
            --url-env variable at runtime — never pass a literal URL on the
            command line or store one in .tasks/config.json.

${dim("Examples:")}
  tk init
  tk init --prefix myapp
  tk init --backend sqlite
  tk init --backend sqlite --filename issues.db
  tk init --backend postgres --url-env MYAPP_DATABASE_URL

${dim("Backend selection lives only in .tasks/config.json:")} no other tk
command takes a --backend flag, and none is ever read at runtime. --backend
here is only a convenience for writing storage.backend during init instead of
hand-editing the file. To move an existing workspace's data to a different
backend, use ${cyan("tk switch-backend")} instead of hand-editing storage.backend
(see ${cyan("tk switch-backend --help")}) — editing the config alone only changes
which store future commands read from, it does not move data.
`;

/** `tk switch-backend --help` / `tk help switch-backend`: moves existing data to a new backend and flips storage.backend. */
export const SWITCH_BACKEND_HELP = `${bold("tk switch-backend")} — move workspace data to a different storage backend

${dim("Usage:")}
  tk switch-backend <file|sqlite|postgres> [--filename <name>] [--url-env <VAR>] [--dry-run]

${dim("Flags:")}
  --filename <name>  sqlite target only — db filename inside .tasks/ (default: tasks.db)
  --url-env <VAR>    postgres target only — env var holding the connection string
                     (default: TASKS_DATABASE_URL)
  --dry-run          report what would move without writing anything

${dim("What it does:")}
  1. Reads every issue from the workspace's current backend.
  2. Writes them all into the target backend (same wire format as
     ${cyan("tk export")} / ${cyan("tk import")} — issues, comments, dependencies, history).
  3. Only on success, flips storage.backend in .tasks/config.json so every
     command after this one reads the new backend.

${dim("Safety:")}
  The old backend's data is never deleted. A sqlite file or file/ directory
  left behind by a previous backend stays on disk — remove it yourself once
  you've confirmed the new backend looks right (${cyan("tk doctor")}, ${cyan("tk list")}).
  Switching to the backend already in use, at the same location, is rejected
  with nothing changed.

${dim("Examples:")}
  tk switch-backend sqlite
  tk switch-backend file
  tk switch-backend postgres --url-env MYAPP_DATABASE_URL
  tk switch-backend sqlite --dry-run
`;

/* ------------------------------------------------------------------ */
/* Output dispatch — JSON stays byte-identical, humans get formatting. */
/* ------------------------------------------------------------------ */

export function output(value: unknown, json: boolean): void {
  if (json) { console.log(JSON.stringify(value)); return; }
  if (Array.isArray(value)) { for (const item of value) { const record = item as Record<string, unknown>; console.log(`${String(record["id"] ?? "")}\t${String(record["status"] ?? "")}\t${String(record["title"] ?? JSON.stringify(item))}`); } return; }
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}
