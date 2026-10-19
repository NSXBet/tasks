import { Value } from 'typebox/value';
import type { TasksSurface } from '@tasks/surface';
import { PROTOCOL_VERSION, type RpcRequest, type RpcResponse, type RpcWireError } from './protocol.js';
import { VERB_TABLE, type RpcContext, type RpcOutcome } from './verbs.js';

/**
 * Transport-agnostic dispatcher: request frame in, outcome out. Transports own
 * the surface lifecycle via {@link SurfaceLease} — the web server memoizes one
 * surface for its lifetime (no-op dispose); the daemon opens/closes per call.
 * Frames are JSON-safe by construction: params are typebox-validated, handlers
 * return wire-safe values.
 */

/** A surface plus how the transport retires it after dispatch settles. */
export interface SurfaceLease {
  readonly surface: TasksSurface;
  /** Called exactly once after the verb settles; resolves when the surface is released. */
  dispose(): Promise<void>;
}

/** Provider that opens a surface per call and closes it after the verb settles. */
export const perCallLease = (open: (root: string) => Promise<TasksSurface>): ((root: string) => Promise<SurfaceLease>) =>
  async (root) => {
    const surface = await open(root);
    return { surface, dispose: () => surface.store.close() };
  };

const fail = (kind: string, message: string): RpcOutcome => ({ ok: false, error: { kind, message } });

export const dispatchRpc = async (request: RpcRequest, provide: (root: string) => Promise<SurfaceLease>, ctx: RpcContext): Promise<RpcOutcome> => {
  if (request.v !== PROTOCOL_VERSION) return fail('contract_mismatch', `protocol version ${request.v} unsupported, expected ${PROTOCOL_VERSION}`);
  const entry = VERB_TABLE[request.method];
  if (entry === undefined) return fail('method_unknown', `unknown method: ${request.method}`);

  const params: unknown = request.params ?? {};
  if (entry.params !== undefined && !Value.Check(entry.params, params)) {
    const first = Value.Errors(entry.params, params)[0];
    const detail = first ? `${first.instancePath || 'params'}: ${first.message}` : 'invalid params';
    return fail('param_invalid', detail);
  }

  let lease: SurfaceLease | undefined;
  if (request.method !== 'hello') {
    if (typeof request.root !== 'string' || request.root.trim() === '') return fail('root_invalid', 'missing root');
    try {
      lease = await provide(request.root);
    } catch (error) {
      // createSurface classifies discovery failures as MessageError; any throw here means the root is unusable.
      return fail('root_invalid', error instanceof Error ? error.message : String(error));
    }
  }

  try {
    return await entry.handler(lease?.surface as TasksSurface, params, ctx);
  } catch (error) {
    return fail('internal', error instanceof Error ? error.message : String(error));
  } finally {
    if (lease !== undefined) await lease.dispose().catch(() => {});
  }
};

/** Frame helper for transports: outcome → response envelope echoing the request id. */
export const rpcResponse = (request: RpcRequest, outcome: RpcOutcome): RpcResponse => ({
  v: PROTOCOL_VERSION,
  ...(request.id === undefined ? {} : { id: request.id }),
  ...(outcome.ok ? { ok: true as const, value: outcome.value } : { ok: false as const, error: outcome.error }),
});

export type { RpcWireError };
