import { Type, type TSchema } from 'typebox';
import type { TasksSurface } from '@tasks/surface';
import { PROTOCOL_VERSION, VERBS_VERSION, type RpcWireError } from './protocol.js';

/**
 * The single verb table: every RPC method tk serves, one entry each. The CLI,
 * web routes, and the tkd daemon all dispatch through this table — a method is
 * addable in exactly one place.
 *
 * Handlers return surface Results verbatim (`{ok:true,value}` /
 * `{ok:false,error:{kind,message}}`) — the wire shape already matches. Only
 * composed handlers (hello, board.get) build their own value.
 *
 * Deliberately excluded from RPC v1 (documented here so the table stays the
 * single source of truth):
 * - `surface.evidenceRead` — binary bytes; transports serve it as a blob
 *   route (e.g. web's `/api/issue/:id/blob/:ref`), not a JSON frame.
 * - `surface.watch` — server-push events; arrives as the events channel
 *   (slice 4), not a request/response verb.
 */

export type RpcOutcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: RpcWireError };

/** Per-call context injected by the transport (who is acting, clock). */
export interface RpcContext {
  readonly actor: string;
}

export interface RpcVerb {
  /** One-line, model-facing description: what the verb does, key params, what it returns. Metadata only — not part of the wire contract. */
  readonly description: string;
  /** Typebox schema for `params`; undefined = no params ({} accepted). */
  readonly params: TSchema | undefined;
  /** Validates-and-cast params in dispatch; handler receives checked params. */
  readonly handler: (surface: TasksSurface, params: any, ctx: RpcContext) => Promise<RpcOutcome>;
}

const str = () => Type.String();
const optStr = () => Type.Optional(Type.String());
const optNullOrStr = () => Type.Optional(Type.Union([Type.String(), Type.Null()]));
const id = str();
const metadata = () => Type.Record(Type.String(), Type.Unknown());

const ListOptionsSchema = Type.Object({
  status: optStr(),
  parent: optStr(),
  assignee: optStr(),
  type: optStr(),
  priority: Type.Optional(Type.Number()),
  label: optStr(),
  sprint: optStr(),
  archived: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Number()),
  claim: Type.Optional(Type.Boolean()),
});

const CreateParams = Type.Object({
  title: str(),
  description: optStr(),
  status: optStr(),
  priority: Type.Optional(Type.Number()),
  type: optStr(),
  owner: optNullOrStr(),
  assignee: optNullOrStr(),
  due: optNullOrStr(),
  deferUntil: optNullOrStr(),
  parent: optStr(),
  labels: Type.Optional(Type.Array(str())),
  notes: optNullOrStr(),
  design: optNullOrStr(),
  acceptanceCriteria: optNullOrStr(),
  estimate: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  specId: optNullOrStr(),
  externalRef: optNullOrStr(),
  branch: optNullOrStr(),
  metadata: Type.Optional(metadata()),
  attachments: Type.Optional(Type.Array(Type.Object({ path: str(), metadata: Type.Optional(metadata()) }))),
  deps: Type.Optional(Type.Array(str())),
});

const UpdateParams = Type.Object({
  id,
  title: optStr(),
  description: optNullOrStr(),
  status: optStr(),
  priority: Type.Optional(Type.Number()),
  type: optStr(),
  owner: optNullOrStr(),
  assignee: optNullOrStr(),
  due: optNullOrStr(),
  deferUntil: optNullOrStr(),
  parent: optNullOrStr(),
  labels: Type.Optional(Type.Array(str())),
  notes: optNullOrStr(),
  design: optNullOrStr(),
  acceptanceCriteria: optNullOrStr(),
  estimate: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  specId: optNullOrStr(),
  externalRef: optNullOrStr(),
  branch: optNullOrStr(),
  metadata: Type.Optional(metadata()),
});

/** Verbs whose params are exactly the schema (no unpacking) pass it straight through. */
const verb = (description: string, params: TSchema, handler: RpcVerb['handler']): RpcVerb => ({ description, params, handler });
const noParams = (description: string, handler: RpcVerb['handler']): RpcVerb => ({ description, params: undefined, handler });

const LeaseAcquireParams = Type.Object({
  name: str(),
  holder: str(),
  purpose: optStr(),
  ttlMs: Type.Optional(Type.Number()),
  waitMs: Type.Optional(Type.Number()),
  issue: optNullOrStr(),
});

const LeaseReleaseParams = Type.Object({ name: str(), holder: str() });

const LeaseRenewParams = Type.Object({
  name: str(),
  holder: str(),
  ttlMs: Type.Optional(Type.Number()),
});

export const VERB_TABLE: Readonly<Record<string, RpcVerb>> = {
  hello: noParams('Handshake: returns the tk identity, protocol and verbs versions, and the sorted list of served method names.', async () => ({
    ok: true,
    value: { tk: 'tk', protocol: PROTOCOL_VERSION, verbs: VERBS_VERSION, methods: Object.keys(VERB_TABLE).sort() },
  })),

  'board.get': noParams('Get the whole board in one call: all issues, the acting user, the current time, all sprints, and the active sprint (or null).', async (surface, _params, ctx) => {
    const page = await surface.all();
    if (!page.ok) return page;
    const sprints = await surface.sprintList();
    const list = sprints.ok ? sprints.value : [];
    return {
      ok: true,
      value: {
        issues: page.value,
        actor: ctx.actor,
        now: new Date().toISOString(),
        sprints: list,
        activeSprint: list.find((sprint) => sprint.status === 'active') ?? null,
      },
    };
  }),

  'issue.create': verb('Create an issue. Requires title; optional description, status, priority, type, assignee, parent, labels, deps, and more. Returns the created issue.', CreateParams, (surface, p) => surface.create(p)),
  'issue.show': verb('Show one issue by id with its full detail (fields, dependencies, comments). Returns the issue.', Type.Object({ id }), (surface, p) => surface.show(p.id)),
  'issue.list': verb('List issues, optionally filtered by status, parent, assignee, type, priority, label, sprint, or archived; supports limit. Returns an array of issues.', ListOptionsSchema, (surface, p) => surface.list(p)),
  'issue.ready': verb('List issues that are ready to work on (open, unblocked); accepts the same filters as issue.list. Returns an array of issues.', ListOptionsSchema, (surface, p) => surface.ready(p)),
  'issue.blocked': noParams('List issues that are blocked by unresolved dependencies. Returns an array of issues.', (surface) => surface.blocked()),
  'issue.search': verb('Full-text search issues by text. Returns matching issues.', Type.Object({ text: str() }), (surface, p) => surface.search(p.text)),
  'issue.query': verb('Query issues with a filter expression string. Returns matching issues.', Type.Object({ expression: str() }), (surface, p) => surface.query(p.expression)),
  'issue.stale': verb('List issues not updated in the given number of days. Returns an array of issues.', Type.Object({ days: Type.Number() }), (surface, p) => surface.stale(p.days)),
  'issue.orphans': noParams('List issues with no parent epic and no dependencies. Returns an array of issues.', (surface) => surface.orphans()),
  'issue.children': verb('List the direct child issues of an issue by id. Returns an array of issues.', Type.Object({ id }), (surface, p) => surface.children(p.id)),
  'issue.epic': verb('Show an epic by id with its children and progress. Returns the epic summary.', Type.Object({ id }), (surface, p) => surface.epic(p.id)),
  'issue.update': verb('Update fields of an issue by id (title, description, status, priority, type, assignee, parent, labels, notes, and more). Only supplied fields change. Returns the updated issue.', UpdateParams, (surface, { id: issueId, ...patch }) => surface.update(issueId, patch)),
  'issue.status': verb('Set an issue status by id, with an optional reason. Returns the updated issue.', Type.Object({ id, status: str(), reason: Type.Optional(str()) }), (surface, p) => surface.status(p.id, { status: p.status, reason: p.reason })),
  'issue.finish': verb('Hand an issue over for review: stamps the session id and moves it to ready-to-review. Requires id and session. Returns the updated issue.', Type.Object({ id, session: str() }), (surface, p) => surface.finish(p.id, p.session)),
  'issue.defer': verb('Defer an issue by id, optionally until a date. Returns the updated issue.', Type.Object({ id, until: Type.Optional(str()) }), (surface, p) => surface.defer(p.id, p.until)),
  'issue.undefer': verb('Clear the deferral of an issue by id. Returns the updated issue.', Type.Object({ id }), (surface, p) => surface.undefer(p.id)),
  'issue.archive': verb('Archive an issue by id. Returns the updated issue.', Type.Object({ id }), (surface, p) => surface.archive(p.id)),
  'issue.unarchive': verb('Restore an archived issue by id. Returns the updated issue.', Type.Object({ id }), (surface, p) => surface.unarchive(p.id)),
  'issue.claim': verb('Claim an issue by id for the acting user and mark it in progress. Returns the updated issue.', Type.Object({ id }), (surface, p) => surface.claim(p.id)),
  'issue.assign': verb('Assign an issue by id to the given assignee. Returns the updated issue.', Type.Object({ id, assignee: str() }), (surface, p) => surface.assign(p.id, p.assignee)),
  'issue.priority': verb('Set the numeric priority of an issue by id. Returns the updated issue.', Type.Object({ id, priority: Type.Number() }), (surface, p) => surface.priority(p.id, p.priority)),
  'issue.labelAdd': verb('Add a label to an issue by id. Returns the updated issue.', Type.Object({ id, label: str() }), (surface, p) => surface.labelAdd(p.id, p.label)),
  'issue.labelRemove': verb('Remove a label from an issue by id. Returns the updated issue.', Type.Object({ id, label: str() }), (surface, p) => surface.labelRemove(p.id, p.label)),
  'issue.note': verb('Append a progress note (body) to an issue by id. Returns the updated issue.', Type.Object({ id, body: str() }), (surface, p) => surface.note(p.id, p.body)),
  'issue.duplicate': verb('Mark an issue as a duplicate of a canonical issue and close it. Requires id and canonical.', Type.Object({ id, canonical: str() }), (surface, p) => surface.duplicate(p.id, p.canonical)),
  'issue.supersede': verb('Mark an issue as superseded by a replacement issue and close it. Requires id and replacement.', Type.Object({ id, replacement: str() }), (surface, p) => surface.supersede(p.id, p.replacement)),
  'issue.closeMany': verb('Close several issues by ids with an optional shared reason. Returns the closed issues.', Type.Object({ ids: Type.Array(str()), reason: Type.Optional(str()) }), (surface, p) => surface.closeMany(p.ids, p.reason)),
  'issue.rename': verb('Rename an issue id from one id to another (from, to). Returns the renamed issue.', Type.Object({ from: str(), to: str() }), (surface, p) => surface.rename(p.from, p.to)),
  'issue.delete': verb('Permanently delete issues by ids. Returns the deleted ids.', Type.Object({ ids: Type.Array(str()) }), (surface, p) => surface.delete(p.ids)),
  'issue.attach': verb('Attach a file (by path, with optional metadata) to an issue as evidence. Returns the updated issue.', Type.Object({ id, path: str(), metadata: Type.Optional(metadata()) }), (surface, p) => surface.attach(p.id, p.path, p.metadata)),
  'issue.detach': verb('Detach a file from an issue by its path. Returns the updated issue.', Type.Object({ id, path: str() }), (surface, p) => surface.detach(p.id, p.path)),
  'issue.detachBlob': verb('Detach an attachment from an issue by its blob ref. Returns the updated issue.', Type.Object({ id, ref: str() }), (surface, p) => surface.detachBlob(p.id, p.ref)),
  'issue.comments': verb('List the comments on an issue by id. Returns an array of comments.', Type.Object({ id }), (surface, p) => surface.comments(p.id)),
  'issue.comment': verb('Add a comment (body) to an issue by id. Returns the new comment.', Type.Object({ id, body: str() }), (surface, p) => surface.comment(p.id, p.body)),

  'comments.list': verb('List the review comments on an issue by id. Returns an array of review comments.', Type.Object({ id }), (surface, p) => surface.reviewComments(p.id)),
  'comments.send': verb('Send review comments on an issue (all, or only the given comment ids) back to the agent. Returns the sent comments.', Type.Object({ id, ids: Type.Optional(Type.Array(str())) }), (surface, p) => surface.reviewCommentsSend(p.id, p.ids)),
  'comments.status': verb('Set the status of a review comment (for example resolved) on an issue. Requires id, comment, and status.', Type.Object({ id, comment: str(), status: str() }), (surface, p) => surface.reviewCommentStatus(p.id, p.comment, p.status)),

  'deps.list': verb('List the dependencies of an issue by id; direction up or down. Returns an array of dependency edges.', Type.Object({ id, direction: Type.Optional(Type.Union([Type.Literal('up'), Type.Literal('down')])) }), (surface, p) => surface.depList(p.id, p.direction)),
  'deps.add': verb('Add a dependency from an issue (id) on a target issue, with an optional dependency type. Returns the edge.', Type.Object({ id, target: str(), type: Type.Optional(str()) }), (surface, p) => surface.depAdd(p.id, p.target, p.type)),
  'deps.remove': verb('Remove the dependency from an issue (id) on a target issue, with an optional dependency type.', Type.Object({ id, target: str(), type: Type.Optional(str()) }), (surface, p) => surface.depRemove(p.id, p.target, p.type)),
  'deps.link': verb('Link two issues (id1, id2) with an optional relation type. Returns the link.', Type.Object({ id1: str(), id2: str(), type: Type.Optional(str()) }), (surface, p) => surface.link(p.id1, p.id2, p.type)),

  'sprint.list': noParams('List all sprints. Returns an array of sprints.', (surface) => surface.sprintList()),
  'sprint.start': verb('Start a new sprint by name; optionally carry over unfinished issues. Returns the sprint.', Type.Object({ name: str(), carry: Type.Optional(Type.Boolean()) }), (surface, p) => surface.sprintStart(p.name, { carry: p.carry })),
  'sprint.close': noParams('Close the active sprint. Returns the closed sprint.', (surface) => surface.sprintClose()),
  'sprint.add': verb('Add an issue by id to the active sprint. Returns the updated issue.', Type.Object({ id }), (surface, p) => surface.sprintAdd(p.id)),
  'sprint.remove': verb('Remove an issue by id from its sprint. Returns the updated issue.', Type.Object({ id }), (surface, p) => surface.sprintRemove(p.id)),
  'sprint.move': verb('Move an issue by id to a target sprint. Returns the updated issue.', Type.Object({ id, target: str() }), (surface, p) => surface.sprintMove(p.id, p.target)),

  'views.all': noParams('List every issue on the board. Returns an array of issues.', (surface) => surface.all()),
  'views.counts': noParams('Count issues grouped by status. Returns the counts.', (surface) => surface.counts()),
  'views.stats': noParams('Compute board statistics (totals, breakdowns by status, type, priority). Returns the stats.', (surface) => surface.stats()),
  'views.tree': verb('Render the issue hierarchy as a tree; optional all, status filter, and depth. Returns the tree.', Type.Object({ all: Type.Optional(Type.Boolean()), status: optStr(), depth: Type.Optional(Type.Number()) }), (surface, p) => surface.tree({ all: p.all, status: p.status, depth: p.depth })),
  'views.graph': noParams('Return the dependency graph of all issues (nodes and edges).', (surface) => surface.graph()),
  'views.duplicates': verb('Find likely duplicate issues; optional minSimilarity threshold. Returns groups of similar issues.', Type.Object({ minSimilarity: Type.Optional(Type.Number()) }), (surface, p) => surface.duplicates(p.minSimilarity)),
  'views.lint': verb('Lint issues for missing or inconsistent fields; optionally restrict by ids, type, or status. Returns the findings.', Type.Object({ ids: Type.Optional(Type.Array(str())), type: optStr(), status: optStr() }), (surface, p) => surface.lint({ ids: p.ids, type: p.type, status: p.status })),

  'runtime.list': noParams('List the running agent runtimes (sessions) known to tk. Returns an array of runs.', (surface) => surface.runtimeList().then((value) => ({ ok: true as const, value }))),
  'runtime.activity': verb('List recent runtime activity; optional limit. Returns an array of activity entries.', Type.Object({ limit: Type.Optional(Type.Number()) }), (surface, p) => surface.runtimeActivity({ limit: p.limit }).then((value) => ({ ok: true as const, value }))),
  'inbox.list': verb('List inbox entries from agent runs; optionally include already archived ones (all). Returns an array of entries.', Type.Object({ all: Type.Optional(Type.Boolean()) }), (surface, p) => surface.inbox({ all: p.all }).then((value) => ({ ok: true as const, value }))),
  'inbox.read': verb('Read one inbox entry by runId. Returns the entry.', Type.Object({ runId: str() }), (surface, p) => surface.inboxRead(p.runId).then((value) => ({ ok: true as const, value }))),
  'inbox.archive': verb('Archive an inbox entry by runId.', Type.Object({ runId: str() }), (surface, p) => surface.inboxArchive(p.runId).then((value) => ({ ok: true as const, value }))),

  'lease.acquire': verb('Acquire a named lease for a holder, optionally with purpose, ttlMs, waitMs, and issue. Returns the lease.', LeaseAcquireParams, (surface, p) => surface.leaseAcquire(p)),
  'lease.list': noParams('List the active leases. Returns an array of leases.', (surface) => surface.leaseList()),
  'lease.release': verb('Release a named lease held by holder.', LeaseReleaseParams, (surface, p) => surface.leaseRelease(p)),
  'lease.renew': verb('Renew a named lease held by holder, optionally with a new ttlMs. Returns the lease.', LeaseRenewParams, (surface, p) => surface.leaseRenew(p)),
};

export const verbNames = (): readonly string[] => Object.keys(VERB_TABLE).sort();
