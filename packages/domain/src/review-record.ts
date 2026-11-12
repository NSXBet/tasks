/**
 * The PR-shaped task record's pure pieces: the harness registry, the two
 * review doors, the agent line and the comments summary. Data, not code —
 * adding a harness type is one registry entry.
 */
import type { Issue } from './issue.js';

export interface HarnessEntry {
  readonly id: string;
  /** `first` = reference implementation; `planned` = recognised, not yet integrated. */
  readonly status: 'first' | 'planned';
  readonly note: string;
  /** Env var names whose non-empty presence identifies a session of this harness (read by `tk finish`). */
  readonly env: readonly string[];
}

export const HARNESS_REGISTRY: readonly HarnessEntry[] = [
  { id: 'omp', status: 'first', note: 'the reference harness; detected by PI_SESSION_ID', env: ['PI_SESSION_ID'] },
  { id: 'codex', status: 'planned', note: 'detected by CODEX_THREAD_ID', env: ['CODEX_THREAD_ID'] },
  { id: 'cursor', status: 'planned', note: 'detected by CURSOR_CONVERSATION_ID or CURSOR_AGENT', env: ['CURSOR_CONVERSATION_ID', 'CURSOR_AGENT'] },
];

/** Harness assumed when a finish recorded none (the first registry entry). */
export const DEFAULT_HARNESS = HARNESS_REGISTRY[0]!.id;

const envMatches = (entry: HarnessEntry, env: Readonly<Record<string, string | undefined>>): boolean =>
  entry.env.some((name) => typeof env[name] === 'string' && env[name] !== '');

/**
 * The harness this process runs in, from the env vars each registry entry lists.
 * A non-default entry (registry order) wins over the default, because the default
 * is also the fallback; nothing recognised → the default (first entry). Pure.
 */
export const detectHarness = (env: Readonly<Record<string, string | undefined>>, registry: readonly HarnessEntry[] = HARNESS_REGISTRY): string => {
  const [first, ...rest] = registry;
  if (first === undefined) return DEFAULT_HARNESS;
  const match = rest.find((entry) => envMatches(entry, env));
  return match?.id ?? first.id;
};

export const harnessEntry = (id: string, registry: readonly HarnessEntry[] = HARNESS_REGISTRY): HarnessEntry | null =>
  registry.find((entry) => entry.id === id) ?? null;

export interface AgentRecord {
  readonly harness: string;
  readonly session: string;
  readonly finishedAt: string | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** The agent that finished the task, from metadata written by `tk finish`; null when never finished. */
export const agentRecord = (issue: Pick<Issue, 'metadata'>): AgentRecord | null => {
  const session = str(issue.metadata['agent_session']);
  if (session === null) return null;
  return { harness: str(issue.metadata['agent_harness']) ?? DEFAULT_HARNESS, session, finishedAt: str(issue.metadata['finished_at']) };
};

/** `agent <harness> · session <id> finished <time>` (time = `YYYY-MM-DD HH:MM`); null when no agent record. */
export const agentLine = (issue: Pick<Issue, 'metadata'>): string | null => {
  const record = agentRecord(issue);
  if (record === null) return null;
  const time = record.finishedAt === null ? '' : ` finished ${record.finishedAt.slice(0, 16).replace('T', ' ')}`;
  return `agent ${record.harness} · session ${record.session}${time}`;
};

export interface ReviewDoors {
  readonly tui: string;
  readonly web: string;
}

/**
 * Default web base for the web review door. Mirrors `WEB_DEFAULT_PORT` (21579) in
 * `packages/surface/src/runtime.ts` — domain cannot import surface, so the value is
 * duplicated and a verification test pins the two equal.
 */
export const DEFAULT_WEB_BASE = 'http://localhost:21579';

/** The two doors into one review: the TUI command and the web URL. */
export const reviewDoors = (id: string, webBase: string = DEFAULT_WEB_BASE): ReviewDoors => ({
  tui: `tk review ${id}`,
  web: `${webBase.replace(/\/+$/, '')}/tasks/${id}`,
});

export interface CommentSummary {
  readonly total: number;
  /** open + sent: still needs an answer. */
  readonly open: number;
  readonly resolved: number;
  /** Dismissed comments settle without counting as resolved. */
  readonly dismissed: number;
  /** At least one thread and none open/sent. */
  readonly allResolved: boolean;
}

const THREAD_STATUSES = ['open', 'sent', 'resolved', 'dismissed'] as const;
type ThreadStatus = (typeof THREAD_STATUSES)[number];

/** Stored `status` when valid; legacy `resolved: true` reads as resolved; else open. */
const threadStatus = (thread: Record<string, unknown>): ThreadStatus => {
  const status = thread['status'];
  if (typeof status === 'string' && (THREAD_STATUSES as readonly string[]).includes(status)) return status as ThreadStatus;
  return thread['resolved'] === true ? 'resolved' : 'open';
};

/**
 * Comment counts plus review-thread resolve state, read tolerantly from `metadata.reviewThreads`.
 * open + sent = open; dismissed settles; allResolved = at least one thread and none open/sent.
 * Absent registry counts 0/0 and is not all-resolved.
 */
export const commentSummary = (issue: Pick<Issue, 'comments' | 'commentCount' | 'metadata'>): CommentSummary => {
  const raw = issue.metadata['reviewThreads'];
  let open = 0;
  let resolved = 0;
  let dismissed = 0;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as Record<string, unknown>)['threads'])) {
    for (const thread of (raw as { threads: unknown[] }).threads) {
      if (thread === null || typeof thread !== 'object' || Array.isArray(thread)) continue;
      const status = threadStatus(thread as Record<string, unknown>);
      if (status === 'resolved') resolved += 1;
      else if (status === 'dismissed') dismissed += 1;
      else open += 1;
    }
  }
  const counted = open + resolved + dismissed;
  return { total: Math.max(issue.commentCount, issue.comments.length), open, resolved, dismissed, allResolved: counted > 0 && open === 0 };
};

export const commentsLine = (summary: CommentSummary): string =>
  summary.allResolved
    ? `comments ${summary.total} · All resolved · ${summary.resolved} ✓`
    : `comments ${summary.total} · ${summary.open} open ${summary.resolved} ✓`;
