import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_STORAGE,
  describeStorage,
  openStorage,
  readWorkspaceConfig,
  resolveStorageConfig,
  writeWorkspaceConfig,
} from '../src/index.js';

const dirs: string[] = [];
function tasksDir(): string { const dir = mkdtempSync(join(tmpdir(), 'tk-workspace-')); dirs.push(dir); return dir; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('@tasks/workspace config', () => {
  it('reads a missing config.json as empty rather than failing', async () => {
    const dir = tasksDir();
    expect(await readWorkspaceConfig(dir)).toEqual({});
  });

  it('round-trips prefix and storage through config.json', async () => {
    const dir = tasksDir();
    await writeWorkspaceConfig(dir, { prefix: 'demo', storage: { backend: 'sqlite', filename: 'custom.db' } });
    expect(await readWorkspaceConfig(dir)).toEqual({ prefix: 'demo', storage: { backend: 'sqlite', filename: 'custom.db' } });
  });

  it('rejects an unknown backend rather than silently ignoring it', async () => {
    const dir = tasksDir();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, 'config.json'), JSON.stringify({ storage: { backend: 'mongodb' } }));
    await expect(readWorkspaceConfig(dir)).rejects.toThrow();
  });

  it('defaults to the file backend for a brand-new workspace', async () => {
    const dir = tasksDir();
    expect(await resolveStorageConfig(dir, {})).toEqual(DEFAULT_STORAGE);
  });

  it('honors an explicit storage key over any inference', async () => {
    const dir = tasksDir();
    mkdirSync(join(dir, 'issues'), { recursive: true });
    expect(await resolveStorageConfig(dir, { storage: { backend: 'sqlite' } })).toEqual({ backend: 'sqlite' });
  });

  it('infers sqlite for a pre-existing tasks.db with no declared storage key', async () => {
    const dir = tasksDir();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, 'tasks.db'), '');
    expect(await resolveStorageConfig(dir, {})).toEqual({ backend: 'sqlite' });
  });

  it('does not let a merely-present but empty issues/ directory override sqlite inference', async () => {
    // Regression: an aborted run, a failed switch-backend attempt, or any other process that
    // creates the directory without ever writing an issue file must not flip inference away
    // from the real, populated sqlite database sitting right next to it.
    const dir = tasksDir();
    mkdirSync(join(dir, 'issues'), { recursive: true });
    await Bun.write(join(dir, 'tasks.db'), '');
    expect(await resolveStorageConfig(dir, {})).toEqual({ backend: 'sqlite' });
  });

  it('still infers file backend when issues/ holds real issue files alongside a stale tasks.db', async () => {
    const dir = tasksDir();
    mkdirSync(join(dir, 'issues'), { recursive: true });
    await Bun.write(join(dir, 'issues', 'tk-abc123.json'), '{}');
    await Bun.write(join(dir, 'tasks.db'), '');
    expect(await resolveStorageConfig(dir, {})).toEqual(DEFAULT_STORAGE);
  });

  it('describes storage locations without opening a connection', () => {
    const dir = tasksDir();
    expect(describeStorage(dir, { backend: 'file' })).toEqual({ backend: 'file', location: dir });
    expect(describeStorage(dir, { backend: 'sqlite' })).toEqual({ backend: 'sqlite', location: join(dir, 'tasks.db') });
    expect(describeStorage(dir, { backend: 'postgres' }).location).toMatch(/^<unset: /);
  });
});

describe('@tasks/workspace storage', () => {
  it('opens the file backend and persists an issue across handles', async () => {
    const dir = tasksDir();
    const first = await openStorage(dir, { backend: 'file' });
    expect(first.backend).toBe('file');
    await first.adapter.migrate([]);
    await first.close();
    expect(existsSync(join(dir, 'meta.json'))).toBe(true);
  });

  it('opens the sqlite backend at the expected file path', async () => {
    const dir = tasksDir();
    mkdirSync(dir, { recursive: true });
    const handle = await openStorage(dir, { backend: 'sqlite' });
    expect(handle.backend).toBe('sqlite');
    expect(handle.location).toBe(join(dir, 'tasks.db'));
    await handle.close();
    expect(existsSync(join(dir, 'tasks.db'))).toBe(true);
  });

  it('fails fast when postgres storage has no connection string available', async () => {
    const dir = tasksDir();
    await expect(openStorage(dir, { backend: 'postgres' })).rejects.toThrow(/connection string/);
  });
});
