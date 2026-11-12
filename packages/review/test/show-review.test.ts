import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openSurfaceStore } from '@tasks/surface';
import { taskStoreCommentStore } from '../src/app/taskStoreCommentStore';

/** SC3/SC4 end-to-end: the TUI/web review store writes, a fresh `tk show` process reads. */

const executable = join(import.meta.dir, '../../cli/src/tk.ts');
const dirs: string[] = [];
const scratch = (): string => {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'tk-show-review-')));
  dirs.push(value);
  return value;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const run = (directory: string, args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } => {
  const result = Bun.spawnSync([process.execPath, executable, '-C', directory, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
};
const json = <T>(directory: string, args: readonly string[]): T => {
  const result = run(directory, [...args, '--json']);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
};
const show = (directory: string, id: string): string => {
  const result = run(directory, ['show', id]);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
};

describe('tk show review section', () => {
  it('renders review-store comments with counts, ✓ on resolve and All resolved', async () => {
    const dir = scratch();
    json(dir, ['init', '--prefix', 'tk']);
    const { id } = json<{ id: string }>(dir, ['create', 'review show probe']);

    const store = await openSurfaceStore(dir, { actor: 'reviewer' });
    const reviews = taskStoreCommentStore(store);
    const line = await reviews.createThread(id, { filePath: 'src/a.ts', line: 3, body: 'tighten this' });
    const file = await reviews.createThread(id, { filePath: 'README.md', body: 'document the flag' });
    await store.close();

    const before = show(dir, id);
    expect(before).toContain('REVIEW (2) · 2 open · 0 ✓');
    expect(before).toContain('○ src/a.ts:3');
    expect(before).toContain('tighten this');
    expect(before).toContain('○ README.md');
    expect(before).toContain('comments 2 · 2 open 0 ✓');

    const again = await openSurfaceStore(dir, { actor: 'reviewer' });
    const resolver = taskStoreCommentStore(again);
    await resolver.setThreadStatus(id, line.id, 'resolved');
    await resolver.setThreadStatus(id, file.id, 'resolved');
    await again.close();

    const after = show(dir, id);
    expect(after).toContain('REVIEW (2) · All resolved');
    expect(after).toContain('✓ src/a.ts:3');
    expect(after).toContain('✓ README.md');
    expect(after).toContain('comments 2 · All resolved · 2 ✓');

    const [wire] = json<Array<{ review: { counts: { allResolved: boolean; resolved: number }; comments: Array<{ location: string; status: string }> } }>>(dir, ['show', id]);
    expect(wire?.review.counts).toMatchObject({ allResolved: true, resolved: 2 });
    expect(wire?.review.comments.map((card) => [card.location, card.status])).toEqual([['src/a.ts:3', 'resolved'], ['README.md', 'resolved']]);
  }, 30_000);
});
