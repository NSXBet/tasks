/**
 * The only place in tk that spawns processes on behalf of git.
 *
 * Command modules below never call `spawn` themselves: they take a
 * `ProcessRunner` (defaulting to `bunRunner`), which keeps dispatch testable
 * without a real git binary and gives every git invocation one chokepoint.
 */

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Injected so command dispatch stays testable without a real git binary. */
export interface ProcessRunner {
  run(command: readonly string[], cwd: string, signal?: AbortSignal): Promise<ProcessResult>;
}

/** Default runner under Bun; honors an aborted signal by killing the child. */
export const bunRunner: ProcessRunner = {
  async run(command, cwd, signal) {
    const spawned = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
    if (signal !== undefined) {
      if (signal.aborted) spawned.kill();
      else signal.addEventListener("abort", () => spawned.kill(), { once: true });
    }
    const [stdout, stderr, exited] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text(), spawned.exited]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), code: exited === null ? -1 : exited };
  },
};
