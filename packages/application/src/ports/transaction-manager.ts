import type { Result } from '../result.js';

/** Transaction work receives only scoped resources. Adapter rolls back on thrown or Result failure. */
export interface TransactionManager<TScope> {
  withinTransaction<T>(work: (scope: TScope) => Promise<Result<T>>): Promise<Result<T>>;
}
