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

export const IssueSchema = z.object({
  id: IssueIdSchema, title: IssueTitleSchema, description: IssueDescriptionSchema, status: IssueStatusSchema, priority: IssuePrioritySchema, type: IssueTypeSchema,
  owner: z.string().min(1).nullable(), assignee: z.string().min(1).nullable(), createdBy: z.string().min(1).nullable(), createdAt: TimestampSchema, updatedAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(), closedAt: TimestampSchema.nullable(), dueAt: TimestampSchema.nullable(), deferUntil: TimestampSchema.nullable(), parentId: IssueIdSchema.nullable(),
  labels: z.array(z.string().trim().min(1)).readonly(), notes: z.string().nullable(), design: z.string().nullable(), acceptanceCriteria: z.string().nullable(), estimate: z.number().nonnegative().nullable(),
  specId: z.string().nullable(), externalRef: z.string().nullable(), metadata: MetadataSchema, wireUnknown: MetadataSchema.default({}), dependencies: z.array(DependencyEdgeSchema).readonly(), dependencyCount: z.int().nonnegative(), dependentCount: z.int().nonnegative(), comments: z.array(CommentSchema).readonly(), commentCount: z.int().nonnegative()
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

/** Required boundary for all wire timestamps. Implemented by application/adapter. */
export interface WireTimestampCodec { encode(value: Timestamp): string; decode(value: string): Timestamp; }
const nullableString = z.string().nullable().optional().transform(value => value ?? null);
const nullableNumber = z.number().nullable().optional();
const wireTimestamp = z.string().nullable().optional();
const metadataFromBd = z.union([MetadataSchema, z.string()]).optional().transform((value, context): Metadata => { if (value === undefined) return {}; if (typeof value !== 'string') return value; try { return MetadataSchema.parse(JSON.parse(value)); } catch { context.addIssue({ code: 'custom', message: 'metadata must be JSON object' }); return z.NEVER; } });
const BdDependencySchema = z.object({ issue_id: z.string(), depends_on_id: z.string(), type: DependencyTypeSchema, created_at: z.string(), created_by: nullableString, metadata: metadataFromBd }).passthrough();
const BdCommentSchema = z.object({ id: z.string(), issue_id: z.string(), author: z.string(), text: z.string(), created_at: z.string() }).passthrough();
export const BdWireIssueSchema = z.object({ schema_version: z.literal(1).optional().default(1), _type: z.literal('issue').optional(), id: z.string(), title: z.string(), description: z.string().optional().default(''), status: IssueStatusSchema, priority: z.number(), issue_type: IssueTypeSchema.optional().default('task'), owner: nullableString, assignee: nullableString, created_by: nullableString, created_at: z.string(), updated_at: z.string(), started_at: wireTimestamp, closed_at: wireTimestamp, due_at: wireTimestamp, defer_until: wireTimestamp, parent: nullableString, labels: z.array(z.string()).optional().default([]), notes: nullableString, design: nullableString, acceptance_criteria: nullableString, estimated_minutes: nullableNumber, estimate: nullableNumber, spec_id: nullableString, external_ref: nullableString, metadata: metadataFromBd, dependencies: z.array(BdDependencySchema).optional().default([]), dependency_count: z.number().int().nonnegative().optional(), dependent_count: z.number().int().nonnegative().optional(), comments: z.array(BdCommentSchema).optional().default([]), comment_count: z.number().int().nonnegative().optional() }).passthrough();
export type BdWireIssue = z.input<typeof BdWireIssueSchema>;
export interface BdWireEnvelope { readonly version: 1; readonly issue: Issue; readonly unknown: Metadata; }
const issueFields = new Set(['schema_version','_type','id','title','description','status','priority','issue_type','owner','assignee','created_by','created_at','updated_at','started_at','closed_at','due_at','defer_until','parent','labels','notes','design','acceptance_criteria','estimated_minutes','estimate','spec_id','external_ref','metadata','dependencies','dependency_count','dependent_count','comments','comment_count']);
const dependencyFields = new Set(['issue_id', 'depends_on_id', 'type', 'created_at', 'created_by', 'metadata']);
const commentFields = new Set(['id', 'issue_id', 'author', 'text', 'created_at']);
function unknownFields(source: Record<string, unknown>, known: ReadonlySet<string>): Metadata { const unknown: Record<string, JsonValue> = {}; for (const [key, value] of Object.entries(source)) if (!known.has(key)) unknown[key] = JsonValueSchema.parse(value); return unknown; }
function decodeOptional(codec: WireTimestampCodec, value: string | null | undefined): Timestamp | null { return value == null ? null : codec.decode(value); }
export function issueFromBdWire(value: unknown, timestamps: WireTimestampCodec): BdWireEnvelope {
  const raw = BdWireIssueSchema.parse(value); const source = value as Record<string, unknown>;
  const dependencies = raw.dependencies.map(edge => ({ issueId: issueId(edge.issue_id), target: dependencyTarget(edge.depends_on_id), type: edge.type, createdAt: timestamps.decode(edge.created_at), createdBy: edge.created_by, metadata: edge.metadata, wireUnknown: unknownFields(edge, dependencyFields) }));
  const comments = raw.comments.map(comment => ({ id: comment.id, issueId: issueId(comment.issue_id), author: comment.author, text: comment.text, createdAt: timestamps.decode(comment.created_at), wireUnknown: unknownFields(comment, commentFields) }));
  const topUnknown = unknownFields(source, issueFields);
  const issue = IssueSchema.parse({ id: raw.id, title: raw.title, description: raw.description, status: raw.status, priority: raw.priority, type: raw.issue_type, owner: raw.owner, assignee: raw.assignee, createdBy: raw.created_by, createdAt: timestamps.decode(raw.created_at), updatedAt: timestamps.decode(raw.updated_at), startedAt: decodeOptional(timestamps, raw.started_at), closedAt: decodeOptional(timestamps, raw.closed_at), dueAt: decodeOptional(timestamps, raw.due_at), deferUntil: decodeOptional(timestamps, raw.defer_until), parentId: raw.parent === null ? null : issueId(raw.parent), labels: raw.labels, notes: raw.notes, design: raw.design, acceptanceCriteria: raw.acceptance_criteria, estimate: raw.estimated_minutes ?? raw.estimate ?? null, specId: raw.spec_id, externalRef: raw.external_ref, metadata: raw.metadata, wireUnknown: topUnknown, dependencies, dependencyCount: raw.dependency_count ?? dependencies.length, dependentCount: raw.dependent_count ?? 0, comments, commentCount: raw.comment_count ?? comments.length });
  return { version: 1, issue, unknown: topUnknown };
}
const encodeOptional = (codec: WireTimestampCodec, value: Timestamp | null) => value === null ? null : codec.encode(value);
export function issueToBdWire(envelope: BdWireEnvelope, timestamps: WireTimestampCodec): Record<string, JsonValue> { const { issue, unknown } = envelope; return { ...unknown, ...issue.wireUnknown, schema_version: 1, _type: 'issue', id: issue.id, title: issue.title, description: issue.description, status: issue.status, priority: issue.priority, issue_type: issue.type, owner: issue.owner, assignee: issue.assignee, created_by: issue.createdBy, created_at: timestamps.encode(issue.createdAt), updated_at: timestamps.encode(issue.updatedAt), started_at: encodeOptional(timestamps, issue.startedAt), closed_at: encodeOptional(timestamps, issue.closedAt), due_at: encodeOptional(timestamps, issue.dueAt), defer_until: encodeOptional(timestamps, issue.deferUntil), parent: issue.parentId, labels: [...issue.labels], notes: issue.notes, design: issue.design, acceptance_criteria: issue.acceptanceCriteria, estimated_minutes: issue.estimate, spec_id: issue.specId, external_ref: issue.externalRef, metadata: issue.metadata, dependencies: issue.dependencies.map(edge => ({ ...edge.wireUnknown, issue_id: edge.issueId, depends_on_id: edge.target, type: edge.type, created_at: timestamps.encode(edge.createdAt), created_by: edge.createdBy, metadata: edge.metadata })), dependency_count: issue.dependencyCount, dependent_count: issue.dependentCount, comments: issue.comments.map(comment => ({ ...comment.wireUnknown, id: comment.id, issue_id: comment.issueId, author: comment.author, text: comment.text, created_at: timestamps.encode(comment.createdAt) })), comment_count: issue.commentCount }; }
export const issueFromBdJson = (value: unknown, timestamps: WireTimestampCodec): Issue => issueFromBdWire(value, timestamps).issue;
export const issueId = (value: string): IssueId => IssueIdSchema.parse(value);
export const dependencyTarget = (value: string): DependencyTarget => DependencyTargetSchema.parse(value);
export const issueTitle = (value: string): IssueTitle => IssueTitleSchema.parse(value);
export const issueDescription = (value: string): IssueDescription => IssueDescriptionSchema.parse(value);
export const issuePriority = (value: number): IssuePriority => IssuePrioritySchema.parse(value);
