import type { Timestamp } from '@tasks/domain';

/** Canonical UTC instant codec every database adapter must use at its edge. */
export interface TimestampCodec { encode(value: Date): string; decode(value: string): Timestamp; }
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
export const canonicalTimestampCodec: TimestampCodec = {
  encode(value) { return value.toISOString(); },
  decode(value) { if (!timestampPattern.test(value)) throw new Error('expected ISO-8601 timestamp with offset'); const date = new Date(value); if (Number.isNaN(date.valueOf())) throw new Error('invalid timestamp'); return date; }
};
