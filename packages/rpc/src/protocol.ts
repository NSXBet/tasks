/**
 * RPC wire protocol — the stable contract between tk clients (CLI, web, the
 * pi/omp extension, daemon consumers) and tk servers (in-process dispatcher,
 * tkd unix-socket daemon).
 *
 * Versioning: `protocol` covers the frame shape (request/response fields,
 * error kinds); `verbs` covers the method table (names, params, result
 * shapes). Clients call `hello` first and must fail loudly on mismatch (see
 * {@link expectContract}) rather than guess field shapes.
 */

/** Frame version. Bump on envelope changes (fields, error kinds). */
export const PROTOCOL_VERSION = 2;

/** Verb-table version. Bump when methods, params, or result shapes change. */
export const VERBS_VERSION = 2;

export type RpcErrorCode =
  | 'method_unknown' // method not in the table (client too new, or typo)
  | 'param_invalid' // params failed the verb's schema
  | 'contract_mismatch' // hello negotiation failed
  | 'root_invalid' // root does not resolve to a tasks workspace
  | 'internal'; // unexpected failure — message carries detail

/** Wire error for every failed frame. SurfaceError kinds pass through verbatim. */
export interface RpcWireError {
  readonly kind: string;
  readonly message: string;
}

export interface RpcRequest {
  readonly v: number;
  /** Correlation id; echoed on the response. Transports assign one when absent. */
  readonly id?: string;
  /**
   * Workspace root (absolute path). Required for every method except `hello`;
   * dispatch fails with `root_invalid` when absent. The global daemon serves
   * whichever root each request names.
   */
  readonly root?: string;
  readonly method: string;
  readonly params?: unknown;
}

export type RpcResponse =
  | { readonly v: number; readonly id?: string; readonly ok: true; readonly value: unknown }
  | { readonly v: number; readonly id?: string; readonly ok: false; readonly error: RpcWireError };

/** `hello` result — the server's identity and supported versions. */
export interface HelloResult {
  readonly tk: string;
  readonly protocol: number;
  readonly verbs: number;
  readonly methods: readonly string[];
}

export interface ContractVersions {
  readonly protocol: number;
  readonly verbs: number;
}

/** Thrown by {@link expectContract} when the negotiated versions disagree. */
export class ContractMismatch extends Error {
  constructor(
    readonly client: ContractVersions,
    readonly server: ContractVersions,
  ) {
    super(
      `contract mismatch: client protocol ${client.protocol}/verbs ${client.verbs}, server protocol ${server.protocol}/verbs ${server.verbs} — upgrade one side`,
    );
  }
}

/** Client-side guard after `hello`: throws {@link ContractMismatch} on version drift. */
export const expectContract = (client: ContractVersions, hello: HelloResult): void => {
  if (hello.protocol !== client.protocol || hello.verbs !== client.verbs) throw new ContractMismatch(client, hello);
};
