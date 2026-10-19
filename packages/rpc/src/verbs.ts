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
const verb = (params: TSchema, handler: RpcVerb['handler']): RpcVerb => ({ params, handler });
const noParams = (handler: RpcVerb['handler']): RpcVerb => ({ params: undefined, handler });

export const VERB_TABLE: Readonly<Record<string, RpcVerb>> = {
  hello: noParams(async () => ({
    ok: true,
    value: { tk: 'tk', protocol: PROTOCOL_VERSION, verbs: VERBS_VERSION, methods: Object.keys(VERB_TABLE).sort() },
  })),

  'board.get': noParams(async (surface, _params, ctx) => {
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

  'issue.create': verb(CreateParams, (surface, p) => surface.create(p)),
  'issue.show': verb(Type.Object({ id }), (surface, p) => surface.show(p.id)),
  'issue.list': verb(ListOptionsSchema, (surface, p) => surface.list(p)),
  'issue.ready': verb(ListOptionsSchema, (surface, p) => surface.ready(p)),
  'issue.blocked': noParams((surface) => surface.blocked()),
  'issue.search': verb(Type.Object({ text: str() }), (surface, p) => surface.search(p.text)),
  'issue.query': verb(Type.Object({ expression: str() }), (surface, p) => surface.query(p.expression)),
  'issue.stale': verb(Type.Object({ days: Type.Number() }), (surface, p) => surface.stale(p.days)),
  'issue.orphans': noParams((surface) => surface.orphans()),
  'issue.children': verb(Type.Object({ id }), (surface, p) => surface.children(p.id)),
  'issue.epic': verb(Type.Object({ id }), (surface, p) => surface.epic(p.id)),
  'issue.update': verb(UpdateParams, (surface, { id: issueId, ...patch }) => surface.update(issueId, patch)),
  'issue.status': verb(Type.Object({ id, status: str(), reason: Type.Optional(str()) }), (surface, p) => surface.status(p.id, { status: p.status, reason: p.reason })),
  'issue.finish': verb(Type.Object({ id, session: str() }), (surface, p) => surface.finish(p.id, p.session)),
  'issue.defer': verb(Type.Object({ id, until: Type.Optional(str()) }), (surface, p) => surface.defer(p.id, p.until)),
  'issue.undefer': verb(Type.Object({ id }), (surface, p) => surface.undefer(p.id)),
  'issue.archive': verb(Type.Object({ id }), (surface, p) => surface.archive(p.id)),
  'issue.unarchive': verb(Type.Object({ id }), (surface, p) => surface.unarchive(p.id)),
  'issue.claim': verb(Type.Object({ id }), (surface, p) => surface.claim(p.id)),
  'issue.assign': verb(Type.Object({ id, assignee: str() }), (surface, p) => surface.assign(p.id, p.assignee)),
  'issue.priority': verb(Type.Object({ id, priority: Type.Number() }), (surface, p) => surface.priority(p.id, p.priority)),
  'issue.labelAdd': verb(Type.Object({ id, label: str() }), (surface, p) => surface.labelAdd(p.id, p.label)),
  'issue.labelRemove': verb(Type.Object({ id, label: str() }), (surface, p) => surface.labelRemove(p.id, p.label)),
  'issue.note': verb(Type.Object({ id, body: str() }), (surface, p) => surface.note(p.id, p.body)),
  'issue.duplicate': verb(Type.Object({ id, canonical: str() }), (surface, p) => surface.duplicate(p.id, p.canonical)),
  'issue.supersede': verb(Type.Object({ id, replacement: str() }), (surface, p) => surface.supersede(p.id, p.replacement)),
  'issue.closeMany': verb(Type.Object({ ids: Type.Array(str()), reason: Type.Optional(str()) }), (surface, p) => surface.closeMany(p.ids, p.reason)),
  'issue.rename': verb(Type.Object({ from: str(), to: str() }), (surface, p) => surface.rename(p.from, p.to)),
  'issue.delete': verb(Type.Object({ ids: Type.Array(str()) }), (surface, p) => surface.delete(p.ids)),
  'issue.attach': verb(Type.Object({ id, path: str(), metadata: Type.Optional(metadata()) }), (surface, p) => surface.attach(p.id, p.path, p.metadata)),
  'issue.detach': verb(Type.Object({ id, path: str() }), (surface, p) => surface.detach(p.id, p.path)),
  'issue.detachBlob': verb(Type.Object({ id, ref: str() }), (surface, p) => surface.detachBlob(p.id, p.ref)),
  'issue.comments': verb(Type.Object({ id }), (surface, p) => surface.comments(p.id)),
  'issue.comment': verb(Type.Object({ id, body: str() }), (surface, p) => surface.comment(p.id, p.body)),

  'deps.list': verb(Type.Object({ id, direction: Type.Optional(Type.Union([Type.Literal('up'), Type.Literal('down')])) }), (surface, p) => surface.depList(p.id, p.direction)),
  'deps.add': verb(Type.Object({ id, target: str(), type: Type.Optional(str()) }), (surface, p) => surface.depAdd(p.id, p.target, p.type)),
  'deps.remove': verb(Type.Object({ id, target: str(), type: Type.Optional(str()) }), (surface, p) => surface.depRemove(p.id, p.target, p.type)),
  'deps.link': verb(Type.Object({ id1: str(), id2: str(), type: Type.Optional(str()) }), (surface, p) => surface.link(p.id1, p.id2, p.type)),

  'sprint.list': noParams((surface) => surface.sprintList()),
  'sprint.start': verb(Type.Object({ name: str(), carry: Type.Optional(Type.Boolean()) }), (surface, p) => surface.sprintStart(p.name, { carry: p.carry })),
  'sprint.close': noParams((surface) => surface.sprintClose()),
  'sprint.add': verb(Type.Object({ id }), (surface, p) => surface.sprintAdd(p.id)),
  'sprint.remove': verb(Type.Object({ id }), (surface, p) => surface.sprintRemove(p.id)),
  'sprint.move': verb(Type.Object({ id, target: str() }), (surface, p) => surface.sprintMove(p.id, p.target)),

  'views.all': noParams((surface) => surface.all()),
  'views.counts': noParams((surface) => surface.counts()),
  'views.stats': noParams((surface) => surface.stats()),
  'views.tree': verb(Type.Object({ all: Type.Optional(Type.Boolean()), status: optStr(), depth: Type.Optional(Type.Number()) }), (surface, p) => surface.tree({ all: p.all, status: p.status, depth: p.depth })),
  'views.graph': noParams((surface) => surface.graph()),
  'views.duplicates': verb(Type.Object({ minSimilarity: Type.Optional(Type.Number()) }), (surface, p) => surface.duplicates(p.minSimilarity)),
  'views.lint': verb(Type.Object({ ids: Type.Optional(Type.Array(str())), type: optStr(), status: optStr() }), (surface, p) => surface.lint({ ids: p.ids, type: p.type, status: p.status })),

  'runtime.list': noParams((surface) => surface.runtimeList().then((value) => ({ ok: true as const, value }))),
  'runtime.activity': verb(Type.Object({ limit: Type.Optional(Type.Number()) }), (surface, p) => surface.runtimeActivity({ limit: p.limit }).then((value) => ({ ok: true as const, value }))),
  'inbox.list': verb(Type.Object({ all: Type.Optional(Type.Boolean()) }), (surface, p) => surface.inbox({ all: p.all }).then((value) => ({ ok: true as const, value }))),
  'inbox.read': verb(Type.Object({ runId: str() }), (surface, p) => surface.inboxRead(p.runId).then((value) => ({ ok: true as const, value }))),
  'inbox.archive': verb(Type.Object({ runId: str() }), (surface, p) => surface.inboxArchive(p.runId).then((value) => ({ ok: true as const, value }))),
};

export const verbNames = (): readonly string[] => Object.keys(VERB_TABLE).sort();
