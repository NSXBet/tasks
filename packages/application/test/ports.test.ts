import { describe, expect, expectTypeOf, it } from 'vitest';
import type { IssueId } from '@tasks/domain';
import { canonicalTimestampCodec, err, ok } from '../src/index.js';
import type { ApplicationCompositionRoot, ApplicationPorts, Clock, IdGenerator, IssueUnitOfWork, MigrationPort, Result, TransactionManager, UnitOfWork } from '../src/index.js';

describe('application contracts', () => {
  it('exposes Result ports, scoped rollback transaction and atomic migration contract', () => {
    expectTypeOf<Clock>().toHaveProperty('now'); expectTypeOf<IdGenerator['nextIssueId']>().returns.toEqualTypeOf<IssueId>(); expectTypeOf<IssueUnitOfWork>().toHaveProperty('claimReady'); expectTypeOf<UnitOfWork>().toHaveProperty('withinTransaction'); expectTypeOf<TransactionManager<{ tx: true }>>().toHaveProperty('withinTransaction'); expectTypeOf<MigrationPort>().toHaveProperty('history'); expectTypeOf<ApplicationPorts>().toHaveProperty('unitOfWork'); expectTypeOf<ApplicationCompositionRoot<unknown>>().toHaveProperty('create');
  });
  it('uses canonical adapter timestamp codec', () => { const instant = new Date('2025-01-01T00:00:00.000Z'); expect(canonicalTimestampCodec.decode(canonicalTimestampCodec.encode(instant))).toEqual(instant); expect(() => canonicalTimestampCodec.decode('bad')).toThrow(); });
  it('uses public discriminated result/error taxonomy', () => { const success: Result<number> = ok(1); const failure: Result<number> = err({ kind: 'not_found', resource: 'issue', id: 'tk-5au' }); expect(success).toEqual({ ok: true, value: 1 }); expect(failure).toEqual({ ok: false, error: { kind: 'not_found', resource: 'issue', id: 'tk-5au' } }); });
});
