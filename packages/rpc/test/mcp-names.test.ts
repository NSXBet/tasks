import { describe, expect, it } from 'bun:test';
import { VERB_TABLE, mcpToolName, rpcMethodName, verbNames } from '../src/index';

describe('verb descriptions', () => {
  it('every verb has a non-empty description', () => {
    for (const [name, entry] of Object.entries(VERB_TABLE)) {
      expect(typeof entry.description, name).toBe('string');
      expect(entry.description.trim().length, name).toBeGreaterThan(0);
    }
  });
});

describe('mcp tool names', () => {
  it('maps dots to underscores', () => {
    expect(mcpToolName('issue.create')).toBe('issue_create');
    expect(mcpToolName('hello')).toBe('hello');
  });

  it('produces only MCP-safe characters and unique names', () => {
    const tools = verbNames().map(mcpToolName);
    for (const tool of tools) expect(tool).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(new Set(tools).size).toBe(tools.length);
  });

  it('round-trips for every verb', () => {
    for (const method of verbNames()) expect(rpcMethodName(mcpToolName(method))).toBe(method);
  });

  it('rejects unknown tool names', () => {
    expect(rpcMethodName('nope')).toBeNull();
    expect(rpcMethodName('issue.create')).toBeNull();
    expect(rpcMethodName('')).toBeNull();
  });

  it('verbNames stays sorted', () => {
    const names = verbNames();
    expect(names).toEqual([...names].sort());
  });
});
