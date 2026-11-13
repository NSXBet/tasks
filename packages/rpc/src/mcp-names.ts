import { VERB_TABLE } from './verbs.js';

/**
 * MCP tool names must match `[A-Za-z0-9_-]` (Claude Code normalises anything
 * else to `_`), so the dot in an RPC method becomes `_`: `issue.create` →
 * `issue_create`. Verb names are `[A-Za-z0-9.]` only, so the mapping is 1:1.
 */
export const mcpToolName = (method: string): string => method.replace(/\./g, '_');

const TOOL_TO_METHOD: ReadonlyMap<string, string> = new Map(Object.keys(VERB_TABLE).map((method) => [mcpToolName(method), method]));

/** Reverse of `mcpToolName`, resolved against `VERB_TABLE`; null when no verb maps to the name. */
export const rpcMethodName = (toolName: string): string | null => TOOL_TO_METHOD.get(toolName) ?? null;
