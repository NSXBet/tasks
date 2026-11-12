/**
 * Headless review smoke (D-07): a tk-derived patch of a real git repo
 * (`gitDiffPatch` from @tasks/git) loads into the vendored review model with
 * no TTY — in-process, and from plain node via the bundled smoke script.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitDiffPatch, gitMergeBase } from '@tasks/git';
import { changesetFromPatch } from '../src/headless';

const dirs: string[] = [];
const scratch = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

let repo = '';
let base = '';

const EXPECTED = [
  { path: 'src/a.ts', additions: 1, deletions: 1 },
  { path: 'src/b.ts', additions: 2, deletions: 0 },
  { path: 'README.md', additions: 0, deletions: 2 },
];

beforeAll(async () => {
  repo = scratch('tk-review-smoke-');
  const git = (...args: readonly string[]) => {
    const result = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo, stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  };
  git('init', '-q', '-b', 'main');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  writeFileSync(join(repo, 'README.md'), '# smoke\nscratch repo\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'tk/smoke-1');
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\nexport const b = 20;\nexport const c = 3;\n');
  writeFileSync(join(repo, 'src/b.ts'), 'export const d = 4;\nexport const e = 5;\n');
  git('rm', '-q', 'README.md');
  git('add', '.');
  git('commit', '-q', '-m', 'smoke change');
  const mergeBase = await gitMergeBase(repo, 'tk/smoke-1', 'main');
  if (mergeBase === null) throw new Error('no merge base');
  base = mergeBase;
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const byPath = <T extends { path: string }>(files: readonly T[]): T[] => [...files].sort((a, b) => a.path.localeCompare(b.path));

describe('headless review smoke (in-process)', () => {
  it('loads a tk-derived patch of a real repo into a 3-file changeset', async () => {
    const patch = await gitDiffPatch(repo, base, 'tk/smoke-1');
    expect(patch).not.toBeNull();
    const changeset = changesetFromPatch(patch!, 'smoke', 'tk/smoke-1', null);
    expect(changeset.files).toHaveLength(3);
    const files = changeset.files.map((file) => ({ path: file.path, additions: file.stats.additions, deletions: file.stats.deletions }));
    expect(byPath(files)).toEqual(byPath(EXPECTED));
  });
});

const nodeAvailable = Bun.which('node') !== null;
if (!nodeAvailable) console.warn('headless review smoke (node): skipped — `node` is not on PATH');

describe.skipIf(!nodeAvailable)('headless review smoke (node, no TTY)', () => {
  it('bundles the smoke script for node and opens the scratch repo diff with stdin ignored', () => {
    const out = join(scratch('tk-review-smoke-bundle-'), 'smoke.mjs');
    const script = resolve(import.meta.dir, '../scripts/headless-smoke.ts');
    const build = Bun.spawnSync([process.execPath, 'build', script, '--target=node', '--outfile', out], { stdout: 'pipe', stderr: 'pipe' });
    expect(build.exitCode, build.stderr.toString()).toBe(0);
    const run = Bun.spawnSync(['node', out, repo, '--base', base, '--head', 'tk/smoke-1'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    const summary = JSON.parse(run.stdout.toString()) as { repoRoot: string; base: string; head: string; files: typeof EXPECTED; additions: number; deletions: number };
    expect(summary.base).toBe(base);
    expect(summary.head).toBe('tk/smoke-1');
    expect(byPath(summary.files)).toEqual(byPath(EXPECTED));
    expect(summary.additions).toBe(3);
    expect(summary.deletions).toBe(3);
  }, 60_000);
});
