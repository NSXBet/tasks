import { z } from 'zod';

/** Local identifiers are tk human-readable IDs, never database UUIDs. */
export const IssueIdSchema = z.string().trim().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?:\.[a-z0-9]+)*$/i, 'expected task ID (e.g. tk-abc123)').brand<'IssueId'>();
export type IssueId = z.infer<typeof IssueIdSchema>;
export const ExternalDependencyTargetSchema = z.string().regex(/^external:[^:\s]+:[^\s]+$/, 'expected external:<project>:<capability>').brand<'ExternalDependencyTarget'>();
export type ExternalDependencyTarget = z.infer<typeof ExternalDependencyTargetSchema>;
export const DependencyTargetSchema = z.union([IssueIdSchema, ExternalDependencyTargetSchema]);
export type DependencyTarget = z.infer<typeof DependencyTargetSchema>;
export const IssueTitleSchema = z.string().trim().min(1).max(500).brand<'IssueTitle'>();
export type IssueTitle = z.infer<typeof IssueTitleSchema>;
export const IssueDescriptionSchema = z.string().max(20_000).brand<'IssueDescription'>();
export type IssueDescription = z.infer<typeof IssueDescriptionSchema>;

/** Vocabulary belongs to configured policy, never domain hard-coding. */
const vocabulary = (name: string) => z.string().trim().min(1, `expected non-empty ${name}`);
export const IssueStatusSchema = vocabulary('issue status');
export type IssueStatus = z.infer<typeof IssueStatusSchema>;
export const IssueTypeSchema = vocabulary('issue type');
export type IssueType = z.infer<typeof IssueTypeSchema>;
export const DependencyTypeSchema = vocabulary('dependency type');
export type DependencyType = z.infer<typeof DependencyTypeSchema>;
export const IssuePrioritySchema = z.int().min(0).max(4).brand<'IssuePriority'>();
export type IssuePriority = z.infer<typeof IssuePrioritySchema>;

/** Sprints are named focus buckets, not calendar windows: no dates, at most one active. */
export const SprintIdSchema = z.string().trim().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'expected sprint slug (e.g. auth-refactor)').brand<'SprintId'>();
export type SprintId = z.infer<typeof SprintIdSchema>;
export const SprintNameSchema = z.string().trim().min(1).max(200).brand<'SprintName'>();
export type SprintName = z.infer<typeof SprintNameSchema>;
export const SprintStatusSchema = z.enum(['active', 'completed']);
export type SprintStatus = z.infer<typeof SprintStatusSchema>;
export const TimestampSchema = z.date();
export type Timestamp = z.infer<typeof TimestampSchema>;
const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]));
export const MetadataSchema = z.record(z.string(), JsonValueSchema);
export type Metadata = z.infer<typeof MetadataSchema>;

export const DependencyEdgeSchema = z.object({ issueId: IssueIdSchema, target: DependencyTargetSchema, type: DependencyTypeSchema, createdAt: TimestampSchema, createdBy: z.string().min(1).nullable(), metadata: MetadataSchema, wireUnknown: MetadataSchema }).strict();
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>;
export const CommentSchema = z.object({ id: z.string().min(1), issueId: IssueIdSchema, author: z.string().min(1), text: z.string(), createdAt: TimestampSchema, wireUnknown: MetadataSchema }).strict();
export type Comment = z.infer<typeof CommentSchema>;
export const IssueAttachmentSchema = z.object({ path: z.string().trim().min(1), metadata: MetadataSchema.default({}), wireUnknown: MetadataSchema.default({}) }).strict();
export type IssueAttachment = z.infer<typeof IssueAttachmentSchema>;

export const IssueSchema = z.object({
  id: IssueIdSchema, title: IssueTitleSchema, description: IssueDescriptionSchema, status: IssueStatusSchema, priority: IssuePrioritySchema, type: IssueTypeSchema,
  owner: z.string().min(1).nullable(), assignee: z.string().min(1).nullable(), createdBy: z.string().min(1).nullable(), createdAt: TimestampSchema, updatedAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(), closedAt: TimestampSchema.nullable(), dueAt: TimestampSchema.nullable(), deferUntil: TimestampSchema.nullable(), parentId: IssueIdSchema.nullable(),
  /** Focus-bucket membership; null = backlog. Reference is loose at the domain layer, like parentId. */
  sprintId: SprintIdSchema.nullable().default(null),
  labels: z.array(z.string().trim().min(1)).readonly(), notes: z.string().nullable(), design: z.string().nullable(), acceptanceCriteria: z.string().nullable(), estimate: z.number().nonnegative().nullable(),
  specId: z.string().nullable(), externalRef: z.string().nullable(), branch: z.string().trim().min(1).nullable().default(null), metadata: MetadataSchema, attachments: z.array(IssueAttachmentSchema).default([]), wireUnknown: MetadataSchema.default({}), dependencies: z.array(DependencyEdgeSchema).readonly(), dependencyCount: z.int().nonnegative(), dependentCount: z.int().nonnegative(), comments: z.array(CommentSchema).readonly(), commentCount: z.int().nonnegative()
}).strict().superRefine((issue, context) => {
  const fail = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (issue.updatedAt < issue.createdAt) fail('updatedAt', 'updatedAt must not precede createdAt');
  if (issue.startedAt !== null && (issue.startedAt < issue.createdAt || issue.startedAt > issue.updatedAt)) fail('startedAt', 'startedAt must be between createdAt and updatedAt');
  if (issue.closedAt !== null && (issue.closedAt < issue.createdAt || issue.closedAt > issue.updatedAt)) fail('closedAt', 'closedAt must be between createdAt and updatedAt');
  if (issue.dependencyCount < issue.dependencies.length) fail('dependencyCount', 'dependencyCount cannot be smaller than loaded dependency edges');
  if (issue.commentCount < issue.comments.length) fail('commentCount', 'commentCount cannot be smaller than loaded comments');
  for (const edge of issue.dependencies) if (edge.issueId !== issue.id) fail('dependencies', 'dependency edge issueId must match issue ID');
  for (const comment of issue.comments) if (comment.issueId !== issue.id) fail('comments', 'comment issueId must match issue ID');
});
export type Issue = z.infer<typeof IssueSchema>;

export interface StatusTransition { readonly from: IssueStatus; readonly to: IssueStatus; readonly at: Timestamp; }
export type StatusTransitionResult = { readonly allowed: true; readonly startedAt: Timestamp | null; readonly closedAt: Timestamp | null } | { readonly allowed: false; readonly reason: string };
/** Adapter/config supplies lifecycle vocabulary and timestamp effects. */
export interface StatusTransitionPolicy { transition(issue: Pick<Issue, 'status' | 'startedAt' | 'closedAt'>, transition: StatusTransition): StatusTransitionResult; }
export function transitionStatus(policy: StatusTransitionPolicy, issue: Pick<Issue, 'status' | 'startedAt' | 'closedAt'>, transition: StatusTransition): StatusTransitionResult { return policy.transition(issue, transition); }

export const SprintSchema = z.object({
  id: SprintIdSchema, name: SprintNameSchema, status: SprintStatusSchema,
  completedAt: TimestampSchema.nullable(), createdAt: TimestampSchema, updatedAt: TimestampSchema,
  wireUnknown: MetadataSchema.default({}),
}).strict().superRefine((sprint, context) => {
  const fail = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (sprint.updatedAt < sprint.createdAt) fail('updatedAt', 'updatedAt must not precede createdAt');
  // completion timestamp is the status's shadow: exactly one implies the other
  if ((sprint.status === 'completed') !== (sprint.completedAt !== null)) fail('completedAt', 'completedAt must be set exactly when status is completed');
  if (sprint.completedAt !== null && (sprint.completedAt < sprint.createdAt || sprint.completedAt > sprint.updatedAt)) fail('completedAt', 'completedAt must be between createdAt and updatedAt');
});
export type Sprint = z.infer<typeof SprintSchema>;

/** Required boundary for all wire timestamps. Implemented by application/adapter. */
export interface WireTimestampCodec { encode(value: Timestamp): string; decode(value: string): Timestamp; }
const nullableString = z.string().nullable().optional().transform(value => value ?? null);
const nullableNumber = z.number().nullable().optional();
const wireTimestamp = z.string().nullable().optional();
const metadataFromBd = z.union([MetadataSchema, z.string()]).optional().transform((value, context): Metadata => { if (value === undefined) return {}; if (typeof value !== 'string') return value; try { return MetadataSchema.parse(JSON.parse(value)); } catch { context.addIssue({ code: 'custom', message: 'metadata must be JSON object' }); return z.NEVER; } });
const BdDependencySchema = z.object({ issue_id: z.string(), depends_on_id: z.string(), type: DependencyTypeSchema, created_at: z.string(), created_by: nullableString, metadata: metadataFromBd }).passthrough();
const BdCommentSchema = z.object({ id: z.string(), issue_id: z.string(), author: z.string(), text: z.string(), created_at: z.string() }).passthrough();
export const BdWireIssueSchema = z.object({ schema_version: z.literal(1).optional().default(1), _type: z.literal('issue').optional(), id: z.string(), title: z.string(), description: z.string().optional().default(''), status: IssueStatusSchema, priority: z.number(), issue_type: IssueTypeSchema.optional().default('task'), owner: nullableString, assignee: nullableString, created_by: nullableString, created_at: z.string(), updated_at: z.string(), started_at: wireTimestamp, closed_at: wireTimestamp, due_at: wireTimestamp, defer_until: wireTimestamp, parent: nullableString, sprint: nullableString, labels: z.array(z.string()).optional().default([]), notes: nullableString, design: nullableString, acceptance_criteria: nullableString, estimated_minutes: nullableNumber, estimate: nullableNumber, spec_id: nullableString, external_ref: nullableString, branch: nullableString, metadata: metadataFromBd, attachments: z.array(z.object({ path: z.string(), metadata: MetadataSchema.optional().default({}) }).passthrough()).optional().default([]), dependencies: z.array(BdDependencySchema).optional().default([]), dependency_count: z.number().int().nonnegative().optional(), dependent_count: z.number().int().nonnegative().optional(), comments: z.array(BdCommentSchema).optional().default([]), comment_count: z.number().int().nonnegative().optional() }).passthrough();
export type BdWireIssue = z.input<typeof BdWireIssueSchema>;
export interface BdWireEnvelope { readonly version: 1; readonly issue: Issue; readonly unknown: Metadata; }
const issueFields = new Set(Object.keys({ schema_version:1,_type:1,id:1,title:1,description:1,status:1,priority:1,issue_type:1,owner:1,assignee:1,created_by:1,created_at:1,updated_at:1,started_at:1,closed_at:1,due_at:1,defer_until:1,parent:1,sprint:1,labels:1,notes:1,design:1,acceptance_criteria:1,estimated_minutes:1,estimate:1,spec_id:1,external_ref:1,branch:1,metadata:1,attachments:1,dependencies:1,dependency_count:1,dependent_count:1,comments:1,comment_count:1 }));
const dependencyFields = new Set(['issue_id', 'depends_on_id', 'type', 'created_at', 'created_by', 'metadata']);
const attachmentFields = new Set(['path', 'metadata']);
const commentFields = new Set(['id', 'issue_id', 'author', 'text', 'created_at']);
function unknownFields(source: Record<string, unknown>, known: ReadonlySet<string>): Metadata { const unknown: Record<string, JsonValue> = {}; for (const [key, value] of Object.entries(source)) if (!known.has(key)) unknown[key] = JsonValueSchema.parse(value); return unknown; }
function decodeOptional(codec: WireTimestampCodec, value: string | null | undefined): Timestamp | null { return value == null ? null : codec.decode(value); }
export function issueFromBdWire(value: unknown, timestamps: WireTimestampCodec): BdWireEnvelope {
  const raw = BdWireIssueSchema.parse(value); const source = value as Record<string, unknown>;
  const dependencies = raw.dependencies.map(edge => ({ issueId: issueId(edge.issue_id), target: dependencyTarget(edge.depends_on_id), type: edge.type, createdAt: timestamps.decode(edge.created_at), createdBy: edge.created_by, metadata: edge.metadata, wireUnknown: unknownFields(edge, dependencyFields) }));
  const comments = raw.comments.map(comment => ({ id: comment.id, issueId: issueId(comment.issue_id), author: comment.author, text: comment.text, createdAt: timestamps.decode(comment.created_at), wireUnknown: unknownFields(comment, commentFields) }));
  const topUnknown = unknownFields(source, issueFields);
  // Counts may exceed loaded rows by design (pagination), never undershoot — heal stale
  // hand-edited documents with max(stored, loaded) so one bad file cannot brick the store.
  const issue = IssueSchema.parse({ id: raw.id, title: raw.title, description: raw.description, status: raw.status, priority: raw.priority, type: raw.issue_type, owner: raw.owner, assignee: raw.assignee, createdBy: raw.created_by, createdAt: timestamps.decode(raw.created_at), updatedAt: timestamps.decode(raw.updated_at), startedAt: decodeOptional(timestamps, raw.started_at), closedAt: decodeOptional(timestamps, raw.closed_at), dueAt: decodeOptional(timestamps, raw.due_at), deferUntil: decodeOptional(timestamps, raw.defer_until), parentId: raw.parent === null ? null : issueId(raw.parent), sprintId: raw.sprint === null || raw.sprint === undefined ? null : sprintId(raw.sprint), labels: raw.labels, notes: raw.notes, design: raw.design, acceptanceCriteria: raw.acceptance_criteria, estimate: raw.estimated_minutes ?? raw.estimate ?? null, specId: raw.spec_id, externalRef: raw.external_ref, branch: raw.branch, metadata: raw.metadata, attachments: raw.attachments.map(attachment => ({ path: attachment.path, metadata: attachment.metadata, wireUnknown: unknownFields(attachment, attachmentFields) })), wireUnknown: topUnknown, dependencies, dependencyCount: Math.max(raw.dependency_count ?? 0, dependencies.length), dependentCount: raw.dependent_count ?? 0, comments, commentCount: Math.max(raw.comment_count ?? 0, comments.length) });
  return { version: 1, issue, unknown: topUnknown };
}
const encodeOptional = (codec: WireTimestampCodec, value: Timestamp | null) => value === null ? null : codec.encode(value);
export function issueToBdWire(envelope: BdWireEnvelope, timestamps: WireTimestampCodec): Record<string, JsonValue> { const { issue, unknown } = envelope; return { ...unknown, ...issue.wireUnknown, schema_version: 1, _type: 'issue', id: issue.id, title: issue.title, description: issue.description, status: issue.status, priority: issue.priority, issue_type: issue.type, owner: issue.owner, assignee: issue.assignee, created_by: issue.createdBy, created_at: timestamps.encode(issue.createdAt), updated_at: timestamps.encode(issue.updatedAt), started_at: encodeOptional(timestamps, issue.startedAt), closed_at: encodeOptional(timestamps, issue.closedAt), due_at: encodeOptional(timestamps, issue.dueAt), defer_until: encodeOptional(timestamps, issue.deferUntil), parent: issue.parentId, sprint: issue.sprintId, labels: [...issue.labels], notes: issue.notes, design: issue.design, acceptance_criteria: issue.acceptanceCriteria, estimated_minutes: issue.estimate, spec_id: issue.specId, external_ref: issue.externalRef, branch: issue.branch, metadata: issue.metadata, attachments: issue.attachments.map(attachment => ({ ...attachment.wireUnknown, path: attachment.path, metadata: attachment.metadata })), dependencies: issue.dependencies.map(edge => ({ ...edge.wireUnknown, issue_id: edge.issueId, depends_on_id: edge.target, type: edge.type, created_at: timestamps.encode(edge.createdAt), created_by: edge.createdBy, metadata: edge.metadata })), dependency_count: issue.dependencyCount, dependent_count: issue.dependentCount, comments: issue.comments.map(comment => ({ ...comment.wireUnknown, id: comment.id, issue_id: comment.issueId, author: comment.author, text: comment.text, created_at: timestamps.encode(comment.createdAt) })), comment_count: issue.commentCount }; }
export const issueFromBdJson = (value: unknown, timestamps: WireTimestampCodec): Issue => issueFromBdWire(value, timestamps).issue;
export const issueId = (value: string): IssueId => IssueIdSchema.parse(value);
export const dependencyTarget = (value: string): DependencyTarget => DependencyTargetSchema.parse(value);
export const issueTitle = (value: string): IssueTitle => IssueTitleSchema.parse(value);
export const issueDescription = (value: string): IssueDescription => IssueDescriptionSchema.parse(value);
export const issuePriority = (value: number): IssuePriority => IssuePrioritySchema.parse(value);

export interface BdWireSprintEnvelope { readonly version: 1; readonly sprint: Sprint; readonly unknown: Metadata; }
const BdWireSprintSchema = z.object({ schema_version: z.literal(1).optional().default(1), _type: z.literal('sprint').optional(), id: z.string(), name: z.string(), status: SprintStatusSchema, completed_at: z.string().nullable().optional(), created_at: z.string(), updated_at: z.string() }).passthrough();
const sprintFields = new Set(['schema_version', '_type', 'id', 'name', 'status', 'completed_at', 'created_at', 'updated_at']);
export function sprintFromBdWire(value: unknown, timestamps: WireTimestampCodec): BdWireSprintEnvelope {
  const raw = BdWireSprintSchema.parse(value);
  const unknown = unknownFields(value as Record<string, unknown>, sprintFields);
  const sprint = SprintSchema.parse({ id: sprintId(raw.id), name: sprintName(raw.name), status: raw.status, completedAt: raw.completed_at == null ? null : timestamps.decode(raw.completed_at), createdAt: timestamps.decode(raw.created_at), updatedAt: timestamps.decode(raw.updated_at), wireUnknown: unknown });
  return { version: 1, sprint, unknown };
}
export function sprintToBdWire(envelope: BdWireSprintEnvelope, timestamps: WireTimestampCodec): Record<string, JsonValue> {
  const { sprint, unknown } = envelope;
  return { ...unknown, ...sprint.wireUnknown, schema_version: 1, _type: 'sprint', id: sprint.id, name: sprint.name, status: sprint.status, completed_at: sprint.completedAt === null ? null : timestamps.encode(sprint.completedAt), created_at: timestamps.encode(sprint.createdAt), updated_at: timestamps.encode(sprint.updatedAt) };
}
export const sprintId = (value: string): SprintId => SprintIdSchema.parse(value);
export const sprintName = (value: string): SprintName => SprintNameSchema.parse(value);
/** `tk sprint start <name>` slug: lowercase, non-alphanumerics collapse to `-`, digit-leading gains an `s-` prefix. */
export const sprintSlug = (name: string): SprintId => {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 48).replace(/-+$/, '');
  return SprintIdSchema.parse(slug === '' ? 'sprint' : /^[a-z]/.test(slug) ? slug : `s-${slug}`);
};

/** Agents are registered executors runs dispatch work to; presence status is observed, never inferred from runs. */
export const AgentIdSchema = z.string().trim().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'expected agent slug (e.g. code-reviewer)').brand<'AgentId'>();
export type AgentId = z.infer<typeof AgentIdSchema>;
export const AgentNameSchema = z.string().trim().min(1).max(200).brand<'AgentName'>();
export type AgentName = z.infer<typeof AgentNameSchema>;
export const AgentStatusSchema = z.enum(['online', 'idle', 'offline']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export const AgentAccessSchema = z.enum(['workspace', 'project']);
export type AgentAccess = z.infer<typeof AgentAccessSchema>;
export const AgentModeSchema = z.enum(['default', 'autopilot']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const AgentSchema = z.object({
  id: AgentIdSchema, name: AgentNameSchema, description: z.string().default(''),
  owner: z.string().nullable(), runtime: z.string().nullable(),
  access: AgentAccessSchema, mode: AgentModeSchema, status: AgentStatusSchema,
  instructions: z.string().default(''), skills: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).default({}),
  archivedAt: TimestampSchema.nullable(), createdAt: TimestampSchema, updatedAt: TimestampSchema,
  wireUnknown: MetadataSchema.default({}),
}).strict().superRefine((agent, context) => {
  const fail = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (agent.updatedAt < agent.createdAt) fail('updatedAt', 'updatedAt must not precede createdAt');
  if (agent.archivedAt !== null && (agent.archivedAt < agent.createdAt || agent.archivedAt > agent.updatedAt)) fail('archivedAt', 'archivedAt must be between createdAt and updatedAt');
});
export type Agent = z.infer<typeof AgentSchema>;

/** Runs are agent executions against an issue; agentId is null for manual/no-agent runs. */
export const RunIdSchema = z.string().trim().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'expected run slug (e.g. tk-5au-run-1)').brand<'RunId'>();
export type RunId = z.infer<typeof RunIdSchema>;
export const RunTriggerSchema = z.enum(['status-move', 'wakeup', 'manual']);
export type RunTrigger = z.infer<typeof RunTriggerSchema>;
export const RunStateSchema = z.enum(['queued', 'running', 'in_review', 'failed', 'done', 'cancelled']);
export type RunState = z.infer<typeof RunStateSchema>;
export const RunMessageSchema = z.object({ at: TimestampSchema, kind: z.string().min(1), text: z.string() }).strict();
export type RunMessage = z.infer<typeof RunMessageSchema>;

export const RunSchema = z.object({
  id: RunIdSchema, issueId: IssueIdSchema, agentId: AgentIdSchema.nullable(),
  trigger: RunTriggerSchema, state: RunStateSchema,
  startedAt: TimestampSchema.nullable(), closedAt: TimestampSchema.nullable(),
  messages: z.array(RunMessageSchema).default([]),
  usage: z.object({ tokens: z.number().int().nullable(), cost: z.number().nullable() }).strict().default({ tokens: null, cost: null }),
  createdAt: TimestampSchema, updatedAt: TimestampSchema,
  wireUnknown: MetadataSchema.default({}),
}).strict().superRefine((run, context) => {
  const fail = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (run.updatedAt < run.createdAt) fail('updatedAt', 'updatedAt must not precede createdAt');
  if (run.startedAt !== null && (run.startedAt < run.createdAt || run.startedAt > run.updatedAt)) fail('startedAt', 'startedAt must be between createdAt and updatedAt');
  if (run.closedAt !== null && (run.closedAt < run.createdAt || run.closedAt > run.updatedAt)) fail('closedAt', 'closedAt must be between createdAt and updatedAt');
});
export type Run = z.infer<typeof RunSchema>;

export interface BdWireAgentEnvelope { readonly version: 1; readonly agent: Agent; readonly unknown: Metadata; }
export const AgentWireSchema = z.object({ schema_version: z.literal(1).optional().default(1), _type: z.literal('agent').optional(), id: z.string(), name: z.string(), description: z.string().optional().default(''), owner: nullableString, runtime: nullableString, access: AgentAccessSchema, mode: AgentModeSchema, status: AgentStatusSchema, instructions: z.string().optional().default(''), skills: z.array(z.string()).optional().default([]), env: z.record(z.string(), z.string()).optional().default({}), archived_at: wireTimestamp, created_at: z.string(), updated_at: z.string() }).passthrough();
const agentFields = new Set(['schema_version', '_type', 'id', 'name', 'description', 'owner', 'runtime', 'access', 'mode', 'status', 'instructions', 'skills', 'env', 'archived_at', 'created_at', 'updated_at']);
export function agentFromBdWire(value: unknown, timestamps: WireTimestampCodec): BdWireAgentEnvelope {
  const raw = AgentWireSchema.parse(value);
  const unknown = unknownFields(value as Record<string, unknown>, agentFields);
  const agent = AgentSchema.parse({ id: agentId(raw.id), name: agentName(raw.name), description: raw.description, owner: raw.owner, runtime: raw.runtime, access: raw.access, mode: raw.mode, status: raw.status, instructions: raw.instructions, skills: raw.skills, env: raw.env, archivedAt: decodeOptional(timestamps, raw.archived_at), createdAt: timestamps.decode(raw.created_at), updatedAt: timestamps.decode(raw.updated_at), wireUnknown: unknown });
  return { version: 1, agent, unknown };
}
export function agentToBdWire(envelope: BdWireAgentEnvelope, timestamps: WireTimestampCodec): Record<string, JsonValue> {
  const { agent, unknown } = envelope;
  return { ...unknown, ...agent.wireUnknown, schema_version: 1, _type: 'agent', id: agent.id, name: agent.name, description: agent.description, owner: agent.owner, runtime: agent.runtime, access: agent.access, mode: agent.mode, status: agent.status, instructions: agent.instructions, skills: [...agent.skills], env: agent.env, archived_at: encodeOptional(timestamps, agent.archivedAt), created_at: timestamps.encode(agent.createdAt), updated_at: timestamps.encode(agent.updatedAt) };
}
export const agentId = (value: string): AgentId => AgentIdSchema.parse(value);
export const agentName = (value: string): AgentName => AgentNameSchema.parse(value);
/** `tk agent create <name>` slug: lowercase, non-alphanumerics collapse to `-`, digit-leading gains an `s-` prefix. */
export const agentSlug = (name: string): AgentId => {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 48).replace(/-+$/, '');
  return AgentIdSchema.parse(slug === '' ? 'agent' : /^[a-z]/.test(slug) ? slug : `s-${slug}`);
};

export interface BdWireRunEnvelope { readonly version: 1; readonly run: Run; readonly unknown: Metadata; }
export const RunWireSchema = z.object({ schema_version: z.literal(1).optional().default(1), _type: z.literal('run').optional(), id: z.string(), issue_id: z.string(), agent_id: nullableString, trigger: RunTriggerSchema, state: RunStateSchema, started_at: wireTimestamp, closed_at: wireTimestamp, messages: z.array(z.object({ at: z.string(), kind: z.string(), text: z.string() }).passthrough()).optional().default([]), usage: z.object({ tokens: nullableNumber, cost: nullableNumber }).optional(), created_at: z.string(), updated_at: z.string() }).passthrough();
const runFields = new Set(['schema_version', '_type', 'id', 'issue_id', 'agent_id', 'trigger', 'state', 'started_at', 'closed_at', 'messages', 'usage', 'created_at', 'updated_at']);
export function runFromBdWire(value: unknown, timestamps: WireTimestampCodec): BdWireRunEnvelope {
  const raw = RunWireSchema.parse(value);
  const unknown = unknownFields(value as Record<string, unknown>, runFields);
  const run = RunSchema.parse({ id: runId(raw.id), issueId: issueId(raw.issue_id), agentId: raw.agent_id === null ? null : agentId(raw.agent_id), trigger: raw.trigger, state: raw.state, startedAt: decodeOptional(timestamps, raw.started_at), closedAt: decodeOptional(timestamps, raw.closed_at), messages: raw.messages.map(message => ({ at: timestamps.decode(message.at), kind: message.kind, text: message.text })), usage: { tokens: raw.usage?.tokens ?? null, cost: raw.usage?.cost ?? null }, createdAt: timestamps.decode(raw.created_at), updatedAt: timestamps.decode(raw.updated_at), wireUnknown: unknown });
  return { version: 1, run, unknown };
}
export function runToBdWire(envelope: BdWireRunEnvelope, timestamps: WireTimestampCodec): Record<string, JsonValue> {
  const { run, unknown } = envelope;
  return { ...unknown, ...run.wireUnknown, schema_version: 1, _type: 'run', id: run.id, issue_id: run.issueId, agent_id: run.agentId, trigger: run.trigger, state: run.state, started_at: encodeOptional(timestamps, run.startedAt), closed_at: encodeOptional(timestamps, run.closedAt), messages: run.messages.map(message => ({ at: timestamps.encode(message.at), kind: message.kind, text: message.text })), usage: { tokens: run.usage.tokens, cost: run.usage.cost }, created_at: timestamps.encode(run.createdAt), updated_at: timestamps.encode(run.updatedAt) };
}
export const runId = (value: string): RunId => RunIdSchema.parse(value);
