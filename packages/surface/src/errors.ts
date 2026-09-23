/**
 * Surface error vocabulary. `kind` matches the CLI's JSON error contract
 * (`{ error: { kind, message } }`); message classification preserves the
 * CLI's heuristic kinds for thrown MessageErrors.
 */
import type { AppError } from '@tasks/application';
export type SurfaceErrorKind = 'parse' | 'validation' | 'readonly' | 'not_found' | 'conflict' | 'runtime';
export interface SurfaceError { readonly kind: SurfaceErrorKind; readonly message: string }

/** Error thrown inside moved operation bodies; caught by transact() and classified. */
export class MessageError extends Error {}

/** CLI `fail()` parity: message-only errors map to the tightest kind their wording implies. */
export const classifyMessage = (message: string): SurfaceErrorKind => {
  if (message.startsWith('not found') || message.includes('issue not found') || message.includes('no such')) return 'not_found';
  if (message.includes('invalid') || message.includes('requires') || message.includes('expected')) return 'validation';
  if (message.startsWith('readonly')) return 'readonly';
  return 'runtime';
};

/** Flatten an AppError union (NotFoundError has no `message`) into CLI parity text. */
export const appErrorMessage = (error: AppError): string =>
  error.kind === 'not_found' ? `issue ${error.id} not found`
  : error.kind === 'repository' ? `repository ${error.operation} failed`
  : error.kind === 'migration' ? 'storage migration failed'
  : error.message;
