import { join } from 'node:path';
import { readJson, writeJson, withStateLock } from './state-io.js';

/**
 * Resource leases: short-lived, renewable holds on shared machine resources
 * (simulators, dev ports, seeded databases) coordinated through plain files,
 * so any session on the machine can inspect and respect them without a
 * broker. The lease book is advisory — tk serializes access by convention
 * (the agent skills), not by proxying the resource itself.
 *
 * State lives in `<tasksDir>/leases.json` beside the other runtime state
 * files, under the same per-process RMW lock (`withStateLock`) and atomic
 * write as `runtime.json`.
 */

export interface LeaseRow {
  readonly name: string;
  readonly holder: string;
  readonly purpose: string;
  readonly issue: string | null;
  readonly grantedAt: string;
  readonly expiresAt: string;
}

export interface LeaseRequest {
  readonly name: string;
  readonly holder: string;
  readonly purpose: string;
  readonly ttlMs: number;
  readonly issue?: string | null;
}

export type GrantResult =
  | { readonly ok: true; readonly lease: LeaseRow }
  | { readonly ok: false; readonly reason: 'busy'; readonly holder: LeaseRow };

export type RenewResult =
  | { readonly ok: true; readonly lease: LeaseRow }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_holder'; readonly holder: LeaseRow };

export type ReleaseResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_holder'; readonly holder: LeaseRow };

/** Drops rows whose expiry is strictly in the past; `expiresAt === now` keeps
 * the hold so a grant and a sweep racing in the same millisecond cannot
 * revoke a just-acquired lease. */
export const sweepLeases = (book: readonly LeaseRow[], now: Date): { book: readonly LeaseRow[]; released: readonly LeaseRow[] } => {
  const live = book.filter((entry) => new Date(entry.expiresAt).getTime() >= now.getTime());
  return { book: live, released: book.filter((entry) => !live.includes(entry)) };
};

const toRow = (request: LeaseRequest, now: Date): LeaseRow => ({
  name: request.name,
  holder: request.holder,
  purpose: request.purpose,
  issue: request.issue ?? null,
  grantedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + request.ttlMs).toISOString(),
});

/** Grants a free name; a same-holder re-acquire refreshes the hold instead of
 * failing, which is what a retried client or a restarted session wants. */
export const grantLease = (book: readonly LeaseRow[], request: LeaseRequest, now: Date): GrantResult => {
  const holder = book.find((entry) => entry.name === request.name);
  if (holder !== undefined && holder.holder !== request.holder) return { ok: false, reason: 'busy', holder };
  return { ok: true, lease: toRow(request, now) };
};

export const renewLease = (book: readonly LeaseRow[], name: string, holder: string, ttlMs: number, now: Date): RenewResult => {
  const held = book.find((entry) => entry.name === name);
  if (held === undefined) return { ok: false, reason: 'not_found' };
  if (held.holder !== holder) return { ok: false, reason: 'not_holder', holder: held };
  return { ok: true, lease: { ...held, expiresAt: new Date(now.getTime() + ttlMs).toISOString() } };
};

export const releaseLease = (book: readonly LeaseRow[], name: string, holder: string): ReleaseResult => {
  const held = book.find((entry) => entry.name === name);
  if (held === undefined) return { ok: false, reason: 'not_found' };
  if (held.holder !== holder) return { ok: false, reason: 'not_holder', holder: held };
  return { ok: true };
};

/** Busy guidance naming the holder, purpose, linked task, and remaining TTL —
 * the text surfaces land in CLI errors and `tk lease status`. */
export const leaseBusyMessage = (holder: LeaseRow, now: Date): string => {
  const remainingMs = new Date(holder.expiresAt).getTime() - now.getTime();
  const remaining = remainingMs >= 120_000 ? `${Math.floor(remainingMs / 60_000)}m` : `${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
  const details = [holder.purpose !== '-' ? holder.purpose : undefined, holder.issue ?? undefined].filter(Boolean).join(', ');
  const what = details === '' ? '' : ` (${details})`;
  return `resource '${holder.name}' is held by ${holder.holder}${what} — ${remaining} left; pass --wait to queue, or ask the holder to release`;
};

export class LeaseBusyError extends Error {
  constructor(message: string, readonly holder: LeaseRow) {
    super(message);
    this.name = 'LeaseBusyError';
  }
}

export class LeaseStateError extends Error {
  constructor(message: string, readonly reason: 'not_found' | 'not_holder', readonly holder?: LeaseRow) {
    super(message);
    this.name = 'LeaseStateError';
  }
}

const leasesPath = (tasksDir: string): string => join(tasksDir, 'leases.json');

/** Reads the book with in-memory expiry filtering — callers never see stale
 * rows. Reads never write: disk-level expiry lands when a mutation sweeps. */
export const readLeases = async (tasksDir: string, now: Date = new Date()): Promise<readonly LeaseRow[]> =>
  sweepLeases(await readJson<readonly LeaseRow[]>(leasesPath(tasksDir), []), now).book;

/** Grants under the RMW lock, persisting the swept book so expiry also lands on disk. */
export const acquireLease = (tasksDir: string, request: LeaseRequest, now: Date = new Date()): Promise<LeaseRow> =>
  withStateLock(tasksDir, async () => {
    const book = sweepLeases(await readJson<readonly LeaseRow[]>(leasesPath(tasksDir), []), now).book;
    const result = grantLease(book, request, now);
    if (!result.ok) throw new LeaseBusyError(leaseBusyMessage(result.holder, now), result.holder);
    await writeJson(leasesPath(tasksDir), [...book, result.lease]);
    return result.lease;
  });

export const renewLeaseFile = (tasksDir: string, name: string, holder: string, ttlMs: number, now: Date = new Date()): Promise<LeaseRow> =>
  withStateLock(tasksDir, async () => {
    const book = sweepLeases(await readJson<readonly LeaseRow[]>(leasesPath(tasksDir), []), now).book;
    const result = renewLease(book, name, holder, ttlMs, now);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        throw new LeaseStateError(`no lease on '${name}' to renew`, 'not_found');
      }
      throw new LeaseStateError(leaseBusyMessage(result.holder, now), 'not_holder', result.holder);
    }
    await writeJson(leasesPath(tasksDir), [...book.filter((entry) => entry.name !== name), result.lease]);
    return result.lease;
  });

export const releaseLeaseFile = (tasksDir: string, name: string, holder: string): Promise<{ ok: true }> =>
  withStateLock(tasksDir, async () => {
    const book = await readJson<readonly LeaseRow[]>(leasesPath(tasksDir), []);
    const result = releaseLease(book, name, holder);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        throw new LeaseStateError(`no lease on '${name}' to release`, 'not_found');
      }
      throw new LeaseStateError(`lease on '${name}' is held by ${result.holder.holder}, not ${holder}`, 'not_holder', result.holder);
    }
    await writeJson(leasesPath(tasksDir), book.filter((entry) => entry.name !== name));
    return result;
  });
