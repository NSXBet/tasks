import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_BASE, HARNESS_REGISTRY, agentLine, commentSummary, commentsLine, detectHarness, harnessEntry, reviewDoors } from '../src/index.js';

describe('review record', () => {
  it('registry is data with omp first, codex and cursor present', () => {
    expect(HARNESS_REGISTRY.map((entry) => entry.id)).toEqual(['omp', 'codex', 'cursor']);
    expect(harnessEntry('omp')?.status).toBe('first');
    expect(harnessEntry('nope')).toBeNull();
  });
  it('agent line renders from metadata, defaulting to the first harness', () => {
    expect(agentLine({ metadata: {} })).toBeNull();
    expect(agentLine({ metadata: { agent_session: 's1', finished_at: '2026-11-10T09:30:12.000Z' } })).toBe('agent omp · session s1 finished 2026-11-10 09:30');
    expect(agentLine({ metadata: { agent_session: 's2', agent_harness: 'codex', finished_at: '2026-11-10T09:30:12.000Z' } })).toBe('agent codex · session s2 finished 2026-11-10 09:30');
  });
  it('doors are the tui command and the web url', () => {
    expect(reviewDoors('tk-1', 'http://x:1/')).toEqual({ tui: 'tk review tk-1', web: 'http://x:1/tasks/tk-1' });
  });
  it('default web base is the real web server port (WEB_DEFAULT_PORT 21579)', () => {
    expect(DEFAULT_WEB_BASE).toBe('http://localhost:21579');
    expect(reviewDoors('tk-1').web).toBe('http://localhost:21579/tasks/tk-1');
  });
  it('detects the harness from session env vars listed on registry entries', () => {
    expect(detectHarness({ CODEX_THREAD_ID: 't1' })).toBe('codex');
    expect(detectHarness({ CURSOR_CONVERSATION_ID: 'c1' })).toBe('cursor');
    expect(detectHarness({ CURSOR_AGENT: '1' })).toBe('cursor');
    expect(detectHarness({ PI_SESSION_ID: 'p1' })).toBe('omp');
    expect(detectHarness({})).toBe('omp');
    expect(detectHarness({ CODEX_THREAD_ID: '', CURSOR_AGENT: '' })).toBe('omp');
  });
  it('a non-default harness beats the default in nested shells', () => {
    expect(detectHarness({ PI_SESSION_ID: 'p', CODEX_THREAD_ID: 't' })).toBe('codex');
  });
  it('detection is registry data: a new entry is detected with no code change', () => {
    const registry = [...HARNESS_REGISTRY, { id: 'zed', status: 'planned' as const, note: 'x', env: ['ZED_SESSION'] }];
    expect(detectHarness({ ZED_SESSION: 'z' }, registry)).toBe('zed');
  });
  it('comments summary reads thread state and degrades without it', () => {
    expect(commentsLine(commentSummary({ comments: [], commentCount: 0, metadata: {} }))).toBe('comments 0 · 0 open 0 ✓');
    const metadata = { reviewThreads: { version: 1, threads: [{ resolved: true }, { resolved: false }, { resolved: false }] } };
    expect(commentsLine(commentSummary({ comments: [], commentCount: 5, metadata }))).toBe('comments 5 · 2 open 1 ✓');
    expect(commentSummary({ comments: [], commentCount: 0, metadata: {} }).allResolved).toBe(false);
  });
  it('comments summary uses stored status: open+sent open, dismissed settles', () => {
    const threads = [{ status: 'open' }, { status: 'sent' }, { status: 'resolved' }, { status: 'dismissed' }, { resolved: true }];
    const summary = commentSummary({ comments: [], commentCount: 5, metadata: { reviewThreads: { version: 1, threads } } });
    expect(summary).toMatchObject({ open: 2, resolved: 2, dismissed: 1, allResolved: false });
  });
  it('comments line reads All resolved when nothing is open or sent', () => {
    const metadata = { reviewThreads: { version: 1, threads: [{ status: 'resolved' }, { status: 'dismissed' }] } };
    const summary = commentSummary({ comments: [], commentCount: 2, metadata });
    expect(summary.allResolved).toBe(true);
    expect(commentsLine(summary)).toBe('comments 2 · All resolved · 1 ✓');
  });
});
