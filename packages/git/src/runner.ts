/**
 * The only place in tk that spawns processes on behalf of git.
 *
 * Command modules below never call `spawn` themselves: they take a
 * `ProcessRunner` (defaulting to `bunRunner`) or, in synchronous hook
 * contexts, a `SyncProcessRunner` (defaulting to `spawnSyncRunner`). That
 * keeps dispatch testable without a real git binary and gives every git
 * invocation one chokepoint. Commands are always argv arrays — never a shell.
 */
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * Per-call options. `raw: true` returns stdout untouched (no trim) for callers
 * that need exact bytes (file blobs); stderr is always trimmed. Default: trimmed.
 */
export interface RunOptions {
  readonly raw?: boolean;
}

/** Injected so command dispatch stays testable without a real git binary. */
export interface ProcessRunner {
  run(command: readonly string[], cwd: string, signal?: AbortSignal, options?: RunOptions): Promise<ProcessResult>;
}

const outOf = (text: string, options: RunOptions | undefined): string => (options?.raw === true ? text : text.trim());

const execFileP = promisify(execFile);

/**
 * node-compatible runner (child_process.execFile); works under Bun too. Never
 * throws: a non-zero exit returns that code with its output, a missing binary
 * returns 127, and an abort returns -1.
 */
export const nodeRunner: ProcessRunner = {
  async run(command, cwd, signal, options) {
    try {
      const { stdout, stderr } = await execFileP(command[0]!, [...command.slice(1)], { cwd, maxBuffer: 16 * 1024 * 1024, ...(signal === undefined ? {} : { signal }) });
      return { stdout: outOf(String(stdout), options), stderr: String(stderr).trim(), code: 0 };
    } catch (cause) {
      const err = cause as { code?: unknown; name?: unknown; stdout?: unknown; stderr?: unknown; message?: string };
      if (typeof err.code === "number") {
        return { stdout: outOf(String(err.stdout ?? ""), options), stderr: String(err.stderr ?? "").trim(), code: err.code };
      }
      const aborted = err.name === "AbortError" || err.code === "ABORT_ERR" || signal?.aborted === true;
      return { stdout: "", stderr: err.message ?? String(cause), code: aborted ? -1 : 127 };
    }
  },
};

const spawnPiped = (command: readonly string[], cwd: string) => Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });

/**
 * Default runner: Bun.spawn under Bun, child_process under node (pi host).
 * Honors an aborted signal by killing the child. Never throws: a spawn failure
 * (missing binary or cwd) returns code 127, like `nodeRunner`.
 */
export const bunRunner: ProcessRunner = {
  async run(command, cwd, signal, options) {
    if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") return nodeRunner.run(command, cwd, signal, options);
    let spawned: ReturnType<typeof spawnPiped>;
    try {
      spawned = spawnPiped(command, cwd);
    } catch (cause) {
      // Missing binary or missing cwd (ENOENT) behaves like a failed probe, not a crash.
      return { stdout: "", stderr: cause instanceof Error ? cause.message : String(cause), code: 127 };
    }
    if (signal !== undefined) {
      if (signal.aborted) spawned.kill();
      else signal.addEventListener("abort", () => spawned.kill(), { once: true });
    }
    const [stdout, stderr, exited] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text(), spawned.exited]);
    return { stdout: outOf(stdout, options), stderr: stderr.trim(), code: exited === null ? -1 : exited };
  },
};

/** Synchronous call shape for git hook contexts, where the caller cannot await. */
export interface SyncProcessRunner {
  runSync(command: readonly string[], cwd?: string, env?: NodeJS.ProcessEnv): ProcessResult;
}

/**
 * Default sync runner (child_process.spawnSync; Bun and node). Output is left
 * untrimmed — hook callers read raw stdout and trim themselves. `env` defaults
 * to the inherited process env.
 */
export const spawnSyncRunner: SyncProcessRunner = {
  runSync(command, cwd, env) {
    const result = spawnSync(command[0]!, [...command.slice(1)], { cwd, env: env ?? process.env, encoding: "utf8" });
    if (result.error !== undefined && result.status === null) {
      return { stdout: result.stdout ?? "", stderr: result.stderr || result.error.message, code: 127 };
    }
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? -1 };
  },
};
