import { findBeadsWorkspace, readJsonlSource, type BeadsSource } from './workspace.js';

/** Spawns a process and captures its streams. Injected so callers stay testable. */
export interface ProcessRunner { run(command: readonly string[], cwd: string): Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number }>; }
/** Source descriptor for a JSONL file, omitting `path` entirely when unknown. */
const jsonlSource = (directory: string, path: string | null): BeadsSource => path === null ? { kind: 'jsonl', directory } : { kind: 'jsonl', directory, path };
export interface ResolveOptions {
  readonly runner?: ProcessRunner;
  /** Beads executable; overridable for pinned or vendored installs. */
  readonly executable?: string;
  /** Read `.beads/issues.jsonl` instead of invoking the CLI. */
  readonly preferJsonl?: boolean;
  /** Include memories, infra beads, templates and gates (`bd export --all`). */
  readonly all?: boolean;
}
export interface ResolvedSource { readonly source: BeadsSource; readonly jsonl: string }
export interface ResolveFailure { readonly kind: 'beads_source'; readonly message: string }

const bunRunner: ProcessRunner = {
  async run(command, cwd) {
    const spawned = Bun.spawn([...command], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text(), spawned.exited]);
    return { stdout, stderr, code };
  },
};

/**
 * Produce beads JSONL for a workspace.
 *
 * `bd export` is preferred because issues live in an embedded Dolt database;
 * `.beads/issues.jsonl` is a passive export that is usually empty. Falling back
 * to an empty JSONL would report a successful migration of zero issues, so an
 * empty file is treated as "no source" rather than "no issues".
 */
export async function resolveBeadsJsonl(from: string, options: ResolveOptions = {}): Promise<{ readonly ok: true; readonly value: ResolvedSource } | { readonly ok: false; readonly error: ResolveFailure }> {
  const workspace = await findBeadsWorkspace(from);
  if (workspace === null) return { ok: false, error: { kind: 'beads_source', message: `no beads workspace found at ${from}` } };

  if (options.preferJsonl ?? false) {
    const text = await readJsonlSource(workspace);
    if (text === null) return { ok: false, error: { kind: 'beads_source', message: `${workspace.directory}/issues.jsonl is missing or empty; omit --from-jsonl to export via bd` } };
    return { ok: true, value: { source: jsonlSource(workspace.directory, workspace.jsonl), jsonl: text } };
  }

  const runner = options.runner ?? bunRunner;
  const executable = options.executable ?? 'bd';
  const command = [executable, 'export', ...(options.all ?? true ? ['--all'] : [])];
  let result: Awaited<ReturnType<ProcessRunner['run']>>;
  try { result = await runner.run(command, from); }
  catch { return { ok: false, error: { kind: 'beads_source', message: `cannot run '${executable}'; install beads or pass --from-jsonl` } }; }

  // bd reports usage errors on stderr while still exiting 0, so stdout must be checked too.
  if (result.code !== 0 || result.stdout.trim() === '') {
    const detail = result.stderr.trim() || result.stdout.trim() || 'no output';
    const text = await readJsonlSource(workspace);
    if (text !== null) return { ok: true, value: { source: jsonlSource(workspace.directory, workspace.jsonl), jsonl: text } };
    return { ok: false, error: { kind: 'beads_source', message: `'${command.join(' ')}' produced no issues: ${detail}` } };
  }
  return { ok: true, value: { source: { kind: 'cli', directory: workspace.directory }, jsonl: result.stdout } };
}
