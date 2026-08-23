import { issueFromBdWire, type Issue, type JsonValue, type Metadata, type WireTimestampCodec } from '@tasks/domain';

/**
 * A single line of `bd export` output. Beads tags every record with `_type`;
 * only `issue` records map onto the tasks domain. Everything else (memories,
 * infrastructure beads, templates, gates) is foreign data we must preserve
 * rather than reject — rejecting one aborts the whole migration.
 */
export interface BeadsRecord {
  readonly line: number;
  readonly type: string;
  readonly raw: Readonly<Record<string, JsonValue>>;
}
export interface BeadsIssueRecord extends BeadsRecord { readonly type: 'issue'; readonly issue: Issue; readonly unknown: Metadata; }
/** Field-precise decode failure, addressed to the offending source line. */
export interface BeadsRecordError { readonly line: number; readonly field: string; readonly message: string; }

const ISSUE = 'issue';
/** Wire fields decoded through the timestamp codec, which throws without a field path. */
const timestampFields = ['created_at', 'updated_at', 'started_at', 'closed_at', 'due_at', 'defer_until'] as const;
type ZodLike = { readonly issues?: readonly { readonly path: readonly (string | number)[]; readonly message: string }[]; readonly message?: string };

/** Split JSONL, tolerating trailing newlines, blank lines and CRLF. */
export function splitRecords(source: string): { readonly records: readonly BeadsRecord[]; readonly errors: readonly BeadsRecordError[] } {
  const records: BeadsRecord[] = [];
  const errors: BeadsRecordError[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    if (text.trim() === '') return;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { errors.push({ line, field: '$', message: 'invalid JSONL' }); return; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { errors.push({ line, field: '$', message: 'expected JSON object' }); return; }
    const raw = parsed as Record<string, JsonValue>;
    // Beads omits `_type` on some legacy exports; issue is the documented default.
    const marker = raw['_type'];
    records.push({ line, type: typeof marker === 'string' ? marker : ISSUE, raw });
  });
  return { records, errors };
}

export const isIssueRecord = (record: BeadsRecord): boolean => record.type === ISSUE;

/**
 * Locate the field responsible for a codec failure.
 *
 * `issueFromBdWire` decodes timestamps outside Zod, so those throws carry no
 * path and would otherwise be reported against `$` — useless when one of six
 * timestamp fields is malformed.
 */
function timestampField(raw: Readonly<Record<string, JsonValue>>, timestamps: WireTimestampCodec): string | null {
  for (const field of timestampFields) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') return field;
    try { timestamps.decode(value); } catch { return field; }
  }
  for (const collection of ['dependencies', 'comments'] as const) {
    const rows = raw[collection];
    if (!Array.isArray(rows)) continue;
    for (const [index, row] of rows.entries()) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
      const value = (row as Record<string, JsonValue>)['created_at'];
      if (typeof value !== 'string') return `${collection}.${index}.created_at`;
      try { timestamps.decode(value); } catch { return `${collection}.${index}.created_at`; }
    }
  }
  return null;
}

/** Decode an issue record through the domain wire codec, keeping unknown fields. */
export function decodeIssue(record: BeadsRecord, timestamps: WireTimestampCodec): { readonly issue: BeadsIssueRecord } | { readonly error: BeadsRecordError } {
  try {
    const envelope = issueFromBdWire(record.raw, timestamps);
    return { issue: { ...record, type: ISSUE, issue: envelope.issue, unknown: envelope.unknown } };
  } catch (cause) {
    const error = cause as ZodLike;
    const detail = error.issues?.[0];
    const field = detail?.path.length ? detail.path.join('.') : timestampField(record.raw, timestamps) ?? '$';
    return { error: { line: record.line, field, message: detail?.message ?? error.message ?? 'invalid record' } };
  }
}
