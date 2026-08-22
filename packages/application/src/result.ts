/** Typed, expected-failure carrier. Public APIs return this instead of leaking adapter errors. */
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type AppError =
  | ValidationError
  | NotFoundError
  | ConflictError
  | LifecycleError
  | RepositoryError
  | MigrationError;

export interface ValidationError { readonly kind: 'validation'; readonly message: string; readonly field?: string; }
export interface NotFoundError { readonly kind: 'not_found'; readonly resource: 'issue'; readonly id: string; }
export interface ConflictError { readonly kind: 'conflict'; readonly message: string; }
export interface LifecycleError { readonly kind: 'lifecycle'; readonly message: string; }
export interface RepositoryError { readonly kind: 'repository'; readonly operation: string; readonly cause: unknown; }
export interface MigrationError { readonly kind: 'migration'; readonly version?: string; readonly cause: unknown; }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
