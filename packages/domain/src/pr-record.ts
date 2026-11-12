/**
 * The task's single pull request (Phase 11 D-01, PR-01): `metadata.pr =
 * {number, url, state}`. gh is the remote truth; this is the local mirror,
 * refreshed only by explicit `tk pr` verbs. Pure: no IO.
 */
import type { Metadata } from './issue.js';

export type PrState = 'open' | 'closed' | 'merged';

/** A type alias (not an interface) so it is assignable to `JsonValue` metadata. */
export type PrRecord = {
  readonly number: number;
  readonly url: string;
  readonly state: PrState;
};

const STATES: readonly PrState[] = ['open', 'closed', 'merged'];

/** gh's `OPEN`/`CLOSED`/`MERGED` (any case) → the lowercase enum; anything else → null. */
export const normalizePrState = (raw: unknown): PrState | null => {
  if (typeof raw !== 'string') return null;
  const lowered = raw.toLowerCase();
  return (STATES as readonly string[]).includes(lowered) ? (lowered as PrState) : null;
};

/** Validates an untrusted `{number, url, state}` (gh output or stored metadata); null when invalid. */
export const parsePrRecord = (value: unknown): PrRecord | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const number = raw['number'];
  const url = raw['url'];
  const state = normalizePrState(raw['state']);
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return null;
  if (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url)) return null;
  if (state === null) return null;
  return { number, url, state };
};

/** Narrowing read of `metadata.pr`; null when absent or malformed. */
export const readPrRecord = (metadata: Metadata): PrRecord | null => parsePrRecord(metadata['pr']);

/** `PR #<n> · <state> · <url>`. */
export const prLine = (record: PrRecord): string => `PR #${record.number} · ${record.state} · ${record.url}`;
