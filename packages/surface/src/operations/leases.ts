import {
  acquireLease, LeaseBusyError, LeaseStateError, readLeases, releaseLeaseFile,
  renewLeaseFile, type LeaseRequest, type LeaseRow,
} from '../leases.js';
import { getOrThrow, type SurfaceStore } from '../store.js';
import type { SurfaceError } from '../errors.js';

/**
 * Lease surface operations: convert the throwing file IO into the Result
 * contract verbs pass through verbatim (`{ok:true,value}` / `{ok:false,
 * error:{kind,message}}`), enforce wire-level bounds, and resolve the
 * optional issue association against the store.
 */

export type LeaseOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SurfaceError };

export interface LeaseAcquireInput {
  readonly name: string;
  readonly holder: string;
  readonly purpose: string;
  /** Hold duration; clamped to [1s, 24h]. */
  readonly ttlMs?: number;
  /** Task the lease is working for; must exist in this workspace. */
  readonly issue?: string | null;
  /** Server-side long-poll: block up to this many ms for the name to free. */
  readonly waitMs?: number;
}

export interface LeaseReleaseInput {
  readonly name: string;
  readonly holder: string;
}

export interface LeaseRenewInput {
  readonly name: string;
  readonly holder: string;
  readonly ttlMs?: number;
}

export const TTL_MIN_MS = 1_000;
export const TTL_MAX_MS = 86_400_000;
export const WAIT_MAX_MS = 300_000;
const POLL_INTERVAL_MS = 250;
export const DEFAULT_TTL_MS = 900_000;

const errOutcome = (kind: SurfaceError['kind'], message: string): { readonly ok: false; readonly error: SurfaceError } =>
  ({ ok: false, error: { kind, message } });

export const clampTtl = (ttlMs: number | undefined): number | SurfaceError => {
  const value = ttlMs ?? DEFAULT_TTL_MS;
  if (value < TTL_MIN_MS || value > TTL_MAX_MS) {
    return { kind: 'validation', message: `invalid ttl: ${value}ms outside [${TTL_MIN_MS}, ${TTL_MAX_MS}]` };
  }
  return value;
};

const requireText = (value: string, field: string): string | SurfaceError => {
  const trimmed = value.trim();
  if (trimmed === '') return { kind: 'validation', message: `invalid ${field}: empty` };
  return trimmed;
};

export const waitDeadline = (waitMs: number | undefined): number | SurfaceError => {
  const value = waitMs ?? 0;
  if (value < 0 || value > WAIT_MAX_MS) {
    return { kind: 'validation', message: `invalid wait: ${value}ms outside [0, ${WAIT_MAX_MS}]` };
  }
  return Date.now() + value;
};

/** Resolves the optional issue association; a named issue must exist in this
 * workspace, so typos fail at acquire time instead of dangling on the row. */
const resolveIssue = async (store: SurfaceStore, issue: string | null | undefined): Promise<string | null | SurfaceError> => {
  const raw = issue?.trim();
  if (raw === undefined || raw === '') return null;
  const found = await store.transact(async (uow) => getOrThrow(uow, raw));
  if (!found.ok) return found.error;
  return found.value.id;
};

/** The acquire loop shared by the surface op and the CLI: polls the file
 * lock until a grant, a busy-exit deadline, or an unexpected failure.
 * `deadline` is a wall-clock epoch ms bound; `null` means never busy. */
export const acquirePolling = async (tasksDir: string, request: LeaseRequest, deadline: number): Promise<LeaseRow> => {
  for (;;) {
    try {
      return await acquireLease(tasksDir, request, new Date());
    } catch (error) {
      if (!(error instanceof LeaseBusyError)) throw error;
      if (Date.now() >= deadline) throw error;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, POLL_INTERVAL_MS);
      await promise;
    }
  }
};

export const leaseAcquire = async (store: SurfaceStore, input: LeaseAcquireInput): Promise<LeaseOutcome<LeaseRow>> => {
  const name = requireText(input.name, 'name');
  if (typeof name !== 'string') return errOutcome(name.kind, name.message);
  const holder = requireText(input.holder, 'holder');
  if (typeof holder !== 'string') return errOutcome(holder.kind, holder.message);
  const ttl = clampTtl(input.ttlMs);
  if (typeof ttl !== 'number') return errOutcome(ttl.kind, ttl.message);
  const issue = await resolveIssue(store, input.issue);
  if (issue !== null && typeof issue !== 'string') return { ok: false, error: issue };
  const deadline = waitDeadline(input.waitMs);
  if (typeof deadline !== 'number') return errOutcome(deadline.kind, deadline.message);

  const request = { name, holder, purpose: input.purpose.trim() === '' ? '-' : input.purpose, ttlMs: ttl, issue };
  try {
    return { ok: true, value: await acquirePolling(store.tasksDir, request, deadline) };
  } catch (error) {
    return errOutcome(error instanceof LeaseBusyError ? 'conflict' : 'runtime', error instanceof Error ? error.message : String(error));
  }
};

export const leaseList = (store: SurfaceStore): Promise<LeaseOutcome<readonly LeaseRow[]>> =>
  readLeases(store.tasksDir).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => errOutcome('runtime', error instanceof Error ? error.message : String(error)),
  );

export const leaseRelease = (store: SurfaceStore, input: LeaseReleaseInput): Promise<LeaseOutcome<{ readonly released: true }>> =>
  releaseLeaseFile(store.tasksDir, input.name, input.holder).then(
    () => ({ ok: true as const, value: { released: true as const } }),
    (error: unknown) => {
      if (error instanceof LeaseStateError && error.reason === 'not_found') return errOutcome('not_found', error.message);
      if (error instanceof LeaseStateError) return errOutcome('conflict', error.message);
      if (error instanceof LeaseBusyError) return errOutcome('conflict', error.message);
      return errOutcome('runtime', error instanceof Error ? error.message : String(error));
    },
  );

export const leaseRenew = (store: SurfaceStore, input: LeaseRenewInput): Promise<LeaseOutcome<LeaseRow>> => {
  const ttl = clampTtl(input.ttlMs);
  if (typeof ttl !== 'number') return Promise.resolve(errOutcome(ttl.kind, ttl.message));
  return renewLeaseFile(store.tasksDir, input.name, input.holder, ttl, new Date()).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => {
      if (error instanceof LeaseStateError && error.reason === 'not_found') return errOutcome('not_found', error.message);
      if (error instanceof LeaseStateError) return errOutcome('conflict', error.message);
      return errOutcome('runtime', error instanceof Error ? error.message : String(error));
    },
  );
};
