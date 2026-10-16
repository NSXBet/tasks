import type { TasksSurface } from "@tasks/surface";
import { IssueSchema, CommentSchema, type Issue } from "@tasks/domain";
import { buildBoard, type TuiStore } from "./store.js";

/**
 * Phase 0 fixture seam: the canonical task→review scenario, hard-coded.
 * No real surface, no mutations — `loadBoard` always returns the same board
 * and every surface mutation reports "WIP" so existing key handlers surface
 * the mock marker through the normal toast path.
 */

export const fixtureIssueId = "tk-142";

const iso = "2026-10-10T09:00:00.000Z";

const fixtureComment = (id: string, author: string, text: string) =>
  CommentSchema.parse({ id, issueId: fixtureIssueId, author, text, createdAt: new Date(iso), wireUnknown: {} });

export const fixtureIssue: Issue = IssueSchema.parse({
  id: fixtureIssueId,
  title: "Fix flaky retry logic in uploader",
  description:
    "Retries in uploader race the refresh mutex; two concurrent refreshes deadlock under load. Serialize refreshes and drop the retry storm.",
  status: "ready-to-review",
  priority: 2,
  type: "task",
  owner: "kyle",
  assignee: "kyle",
  createdBy: "kyle",
  createdAt: new Date(iso),
  updatedAt: new Date(iso),
  startedAt: new Date(iso),
  closedAt: null,
  dueAt: null,
  deferUntil: null,
  parentId: null,
  sprintId: null,
  labels: ["uploader"],
  notes: null,
  design: null,
  acceptanceCriteria: null,
  estimate: null,
  specId: null,
  externalRef: null,
  branch: "tk/tk-142",
  metadata: {},
  attachments: [],
  wireUnknown: {},
  dependencies: [],
  dependencyCount: 0,
  dependentCount: 0,
  comments: [
    fixtureComment("c1", "kyle", "will the mutex deadlock under concurrent upload?"),
    fixtureComment("c2", "agent", "serialized refresh via refreshMutex.run — no shared state"),
    fixtureComment("c3", "sarah", "prefer channel-based retry"),
    fixtureComment("c4", "agent", "channel would drop ordering guarantees; mutex keeps backpressure"),
    fixtureComment("c5", "alex", "bench shows −70% p99; LGTM"),
  ],
  commentCount: 5,
});

/** Author names rendered with the agent badge in the task view. */
export const fixtureAgents: Readonly<Record<string, true>> = { agent: true };

export const fixtureBranch = "tk/tk-142";
export const fixtureBase = "main @ 9f13ee4";
export const fixtureWorktree = "../platform-api-tk-142";

export interface FixtureSession {
  readonly id: string;
  readonly agent: string;
  readonly status: "done" | "running" | "idle";
  readonly kind: "Research" | "Design" | "Structure";
  readonly topic: string;
  readonly duration: string;
}

export const fixtureSessions: readonly FixtureSession[] = [
  { id: "sess-7f3k", agent: "omp", status: "done", kind: "Research", topic: "research patterns", duration: "10m" },
  { id: "sess-k2q9", agent: "omp", status: "running", kind: "Design", topic: "design discussion", duration: "2m" },
  { id: "sess-q5x1", agent: "omp", status: "idle", kind: "Structure", topic: "structure outline", duration: "—" },
];

export interface FixtureArtifact {
  readonly path: string;
  readonly kind: "doc" | "code";
  readonly added: number;
  readonly removed: number;
  readonly comments: number;
  /** Doc artifact: SUMMARY tab — one line per document section. */
  readonly summary?: readonly string[];
  /** Doc artifact: AUTO tab — the rendered markdown body. */
  readonly body?: readonly string[];
}

export const fixtureArtifacts: readonly FixtureArtifact[] = [
  { path: "src/uploader/retry.ts", kind: "code", added: 38, removed: 12, comments: 5 },
  { path: "src/uploader/refresh-mutex.ts", kind: "code", added: 24, removed: 0, comments: 2 },
  {
    path: "docs/plans/sidebar-consolidation.md",
    kind: "doc",
    added: 4,
    removed: 0,
    comments: 1,
    summary: ["Problem — three sidebars, three layouts", "Decision — one Sidebar host, per-view slots", "Migration — collapse over two releases"],
    body: [
      "# Sidebar consolidation",
      "",
      "## Problem",
      "List, board, and graph views each ship their own sidebar; state drifts between them.",
      "",
      "## Decision",
      "One Sidebar host component with per-view slots; selection and filter state hoist to AppContext.",
      "",
      "## Migration",
      "Collapse the board sidebar first, then list, then graph — two releases.",
    ],
  },
  { path: "bench/retry-bench.txt", kind: "code", added: 9, removed: 2, comments: 1 },
];

/** Artifact review thread beside the selected artifact in the artifact view. */
export interface FixtureArtifactComment {
  readonly author: string;
  readonly agent: boolean;
  readonly text: string;
  readonly resolved: boolean;
  /** Shown for resolved comments; e.g. `✓ resolved by reply`. */
  readonly resolvedBy?: string;
}

export const fixtureArtifactComments: readonly FixtureArtifactComment[] = [
  {
    author: "kyle",
    agent: false,
    text: "will the mutex deadlock if REFRESH_URL itself refreshes?",
    resolved: true,
    resolvedBy: "resolved by reply",
  },
  {
    author: "agent",
    agent: true,
    text: "bounded at MAX=5; the timeout surfaces as RetryError, so the caller can retry without us.",
    resolved: true,
    resolvedBy: "agent",
  },
  {
    author: "sarah",
    agent: false,
    text: "throw before returning the parsed body? good catch by the test.",
    resolved: false,
  },
];

/** Code artifact content for the artifact view: file lines with diff kinds. */
export interface FixtureCodeLine {
  readonly kind: "ctx" | "del" | "add";
  readonly no: number;
  readonly text: string;
}

export const fixtureCodeContent: Readonly<Record<string, readonly FixtureCodeLine[]>> = {
  "src/uploader/retry.ts": [
    { kind: "ctx", no: 41, text: "export async function withRetry<T>(token: string): Promise<T> {" },
    { kind: "ctx", no: 42, text: "  const session = await getSession(token)" },
    { kind: "del", no: 43, text: "  const res = await fetch(REFRESH_URL, { token })" },
    { kind: "del", no: 44, text: "  if (res.status === 401) return retry(token)" },
    { kind: "add", no: 43, text: "  const res = await refreshMutex.run(token, async () => {" },
    { kind: "add", no: 44, text: "    return fetch(REFRESH_URL, { token })" },
    { kind: "add", no: 45, text: "  })" },
    { kind: "ctx", no: 46, text: "  if (!res.ok) throw new RetryError(res.status)" },
    { kind: "ctx", no: 47, text: "  return res.json() as Promise<T>" },
    { kind: "ctx", no: 48, text: "}" },
  ],
  "src/uploader/refresh-mutex.ts": [
    { kind: "add", no: 1, text: "export class RefreshMutex {" },
    { kind: "add", no: 2, text: "  private chain: Promise<unknown> = Promise.resolve();" },
    { kind: "add", no: 3, text: "" },
    { kind: "add", no: 4, text: "  run<T>(token: string, task: () => Promise<T>): Promise<T> {" },
    { kind: "add", no: 5, text: "    const next = this.chain.then(() => task());" },
    { kind: "add", no: 6, text: "    this.chain = next.finally(() => this.release(token));" },
    { kind: "add", no: 7, text: "    return next;" },
    { kind: "add", no: 8, text: "  }" },
  ],
  "bench/retry-bench.txt": [
    { kind: "ctx", no: 1, text: "p50  12ms   →  11ms" },
    { kind: "add", no: 2, text: "p99  480ms  →  144ms   (−70%)" },
    { kind: "del", no: 2, text: "p99  480ms  →  501ms" },
    { kind: "ctx", no: 3, text: "runs 200 · seed fixture-7" },
  ],
};

/** Agent rationale rendered between hunks in the diff view. */
export const fixtureAgentNote =
  "Retry now wraps every refresh in RefreshMutex: concurrent callers queue instead of racing the cache, and jitter keeps the thundering herd off the token endpoint.";

/** Fake review thread anchored to a diff line. */
export interface FixtureLineComment {
  readonly author: string;
  readonly agent: boolean;
  readonly line: number;
  readonly text: string;
  readonly resolved: boolean;
  /** Shown for resolved comments, e.g. `✓ resolved by reply`. */
  readonly resolvedBy?: string;
  readonly reply?: {
    readonly author: string;
    readonly agent: boolean;
    readonly text: string;
  };
}

export const fixtureLineComments: readonly FixtureLineComment[] = [
  {
    author: "kyle",
    agent: false,
    line: 14,
    text: "does doFetch propagate 429s back to the retry loop?",
    resolved: false,
    reply: {
      author: "agent",
      agent: true,
      text: "yes — RetryError(status) rethrows and the loop caps at six attempts.",
    },
  },
  {
    author: "sarah",
    agent: false,
    line: 50,
    text: "is Math.random seeded? the bench needs determinism.",
    resolved: false,
  },
];

/**
 * Diff sample shaped the way hunk renders it: per-file hunks with git `@@`
 * headers, collapsed-unchanged fold counts, and old/new line numbers so the
 * TUI can lay the body out unified or split without re-deriving anything.
 */
export type DiffLineKind = "ctx" | "del" | "add";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly oldNo: number | null;
  readonly newNo: number | null;
  readonly text: string;
}

export interface DiffHunk {
  /** Unchanged lines hunk collapses into a `▾ N unchanged lines` fold bar. */
  readonly foldBefore: number;
  /** The git hunk header line, e.g. `@@ -12,3 +12,10 @@`. */
  readonly header: string;
  /** Function scope hunk shows after the `@@` line. */
  readonly context: string;
  readonly lines: readonly DiffLine[];
}

export interface DiffFile {
  readonly path: string;
  readonly status: "A" | "M" | "D";
  readonly added: number;
  readonly removed: number;
  readonly hunks: readonly DiffHunk[];
}

export const fixtureDiffFiles: readonly DiffFile[] = [
  {
    path: "src/uploader/retry.ts",
    status: "M",
    added: 38,
    removed: 12,
    hunks: [
      {
        foldBefore: 11,
        header: "@@ -12,3 +12,10 @@",
        context: "async function refresh",
        lines: [
          { kind: "ctx", oldNo: 12, newNo: 12, text: "  async function refresh(token: string) {" },
          { kind: "del", oldNo: 13, newNo: null, text: "  const res = await fetch(REFRESH_URL, {" },
          { kind: "add", oldNo: null, newNo: 13, text: "  const res = await refreshMutex.run(token, async () => {" },
          { kind: "ctx", oldNo: 14, newNo: 14, text: "    return doFetch(REFRESH_URL, token);" },
          { kind: "add", oldNo: null, newNo: 15, text: "  });" },
          { kind: "ctx", oldNo: 15, newNo: 16, text: "}" },
        ],
      },
      {
        foldBefore: 24,
        header: "@@ -41,4 +48,7 @@",
        context: "export const retryBackoff",
        lines: [
          { kind: "ctx", oldNo: 41, newNo: 48, text: "export const retryBackoff = (attempt: number): number =>" },
          { kind: "del", oldNo: 42, newNo: null, text: "  Math.min(60000, 250 * 2 ** attempt);" },
          { kind: "add", oldNo: null, newNo: 49, text: "  Math.min(60000, 250 * 2 ** attempt) + jitter(attempt);" },
          { kind: "add", oldNo: null, newNo: 50, text: "const jitter = (attempt: number): number =>" },
          { kind: "add", oldNo: null, newNo: 51, text: "  Math.floor(Math.random() * 250 * 2 ** attempt);" },
        ],
      },
    ],
  },
  {
    path: "src/uploader/refresh-mutex.ts",
    status: "A",
    added: 24,
    removed: 0,
    hunks: [
      {
        foldBefore: 0,
        header: "@@ -0,0 +1,24 @@",
        context: "",
        lines: [
          { kind: "add", oldNo: null, newNo: 1, text: "export class RefreshMutex {" },
          { kind: "add", oldNo: null, newNo: 2, text: "  private chain: Promise<unknown> = Promise.resolve();" },
          { kind: "add", oldNo: null, newNo: 3, text: "" },
          { kind: "add", oldNo: null, newNo: 4, text: "  run<T>(token: string, task: () => Promise<T>): Promise<T> {" },
          { kind: "add", oldNo: null, newNo: 5, text: "    const next = this.chain.then(() => task());" },
          { kind: "add", oldNo: null, newNo: 6, text: "    this.chain = next.finally(() => this.release(token));" },
          { kind: "add", oldNo: null, newNo: 7, text: "    return next;" },
          { kind: "add", oldNo: null, newNo: 8, text: "  }" },
        ],
      },
    ],
  },
];

export const fixtureDiffStats: { files: number; added: number; removed: number } = fixtureDiffFiles.reduce(
  (acc, f) => ({ files: acc.files + 1, added: acc.added + f.added, removed: acc.removed + f.removed }),
  { files: 0, added: 0, removed: 0 },
);

/**
 * Fixture-backed TuiStore. Mutating surface calls reject with a "WIP"
 * message so the shell's reportError path prints the mock marker; only
 * `all`/`sprintList` answer with fixture data.
 */
export const openFixtureStore = (): TuiStore => {
  const okAll = { ok: true as const, value: [fixtureIssue] };
  const okComments = { ok: true as const, value: fixtureIssue.comments };
  const wip = { ok: false as const, error: { message: "WIP" } };
  const explicit: Record<string, unknown> = {
    store: { close: async (): Promise<void> => {} },
    all: async () => okAll,
    show: async () => okAll,
    list: async () => okAll,
    sprintList: async () => ({ ok: true as const, value: [] }),
    comments: async () => okComments,
  };
  // Unmocked surface methods answer "WIP" so every mutation reports the
  // mock marker through the shell's normal reportError/toast path.
  const stub = new Proxy(explicit, {
    get: (target, prop) =>
      typeof prop === "string" && prop in target
        ? target[prop]
        : async () => wip,
  }) as unknown as TasksSurface;
  return {
    surface: stub,
    loadBoard: async () => buildBoard([fixtureIssue]),
    watch: () => () => {},
    close: async () => {},
  };
};
