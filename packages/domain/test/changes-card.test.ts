import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_BASE, changesLinks, readReportStat, statCardLine, statFromChangeset, type ChangesView } from '../src/index.js';

const view = (patch: Partial<ChangesView> = {}): ChangesView => ({
  id: 'tk-1',
  source: 'live',
  stale: false,
  at: null,
  stat: { commits: 2, files: 3, additions: 9, deletions: 1 },
  links: changesLinks('tk-1', 'http://h:1'),
  ...patch,
});

describe('changes stat card', () => {
  it('renders plural and singular counts with a U+2212 minus and both links', () => {
    expect(statCardLine(view())).toBe('Changes · tk-1  2 commits · +9 −1 · 3 files  → http://h:1/tasks/tk-1/diff · tk review tk-1');
    expect(statCardLine(view({ stat: { commits: 1, files: 1, additions: 1, deletions: 0 } }))).toContain('1 commit · +1 −0 · 1 file');
  });

  it('marks cached rungs stale; a stale report names its stamp time', () => {
    const report = statCardLine(view({ source: 'report', stale: true, at: '2026-11-10T00:00:00.000Z' }));
    expect(report.endsWith('stale — from finish report 2026-11-10T00:00:00.000Z')).toBe(true);
    expect(statCardLine(view({ source: 'snapshot', stale: true }))).toContain('frozen at close');
    expect(statCardLine(view({ source: 'snapshot', stale: false }))).not.toContain('stale');
  });

  it('is plain text: no ANSI escapes', () => {
    for (const line of [statCardLine(view()), statCardLine(view({ source: 'report', stale: true, at: 'x' }))]) expect(line).not.toContain('\x1b');
  });

  it('links default to the web base and the diff route', () => {
    expect(changesLinks('tk-9')).toEqual({ tui: 'tk review tk-9', web: `${DEFAULT_WEB_BASE}/tasks/tk-9/diff` });
    expect(changesLinks('tk-9', 'http://h/').web).toBe('http://h/tasks/tk-9/diff');
  });

  it('statFromChangeset reduces a payload to counts', () => {
    expect(statFromChangeset({ commits: [1, 2], files: ['a'], counts: { additions: 4, deletions: 2 } })).toEqual({ commits: 2, files: 1, additions: 4, deletions: 2 });
  });

  it('readReportStat narrows metadata.report and rejects malformed values', () => {
    const changes = { commits: 1, files: 1, additions: 1, deletions: 0 };
    expect(readReportStat({ report: { changes, head: 'abc', at: '2026-11-10T00:00:00.000Z' } })).toEqual({ stat: changes, head: 'abc', at: '2026-11-10T00:00:00.000Z' });
    expect(readReportStat({})).toBeNull();
    expect(readReportStat({ report: null })).toBeNull();
    expect(readReportStat({ report: [changes] })).toBeNull();
    expect(readReportStat({ report: { changes: [1, 1, 1, 0] } })).toBeNull();
    expect(readReportStat({ report: { changes: { ...changes, additions: -1 } } })).toBeNull();
    expect(readReportStat({ report: { changes: { ...changes, files: 1.5 } } })).toBeNull();
    expect(readReportStat({ report: { changes: { ...changes, commits: '1' } } })).toBeNull();
  });
});
