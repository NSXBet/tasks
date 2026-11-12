/**
 * The one place tk runs `gh` (Phase 11 D-01/D-04). gh is not git, so it lives
 * here rather than in @tasks/git, but it reuses that package's generic
 * `ProcessRunner` chokepoint: argv arrays only, never a shell string. tk never
 * reads `GH_TOKEN`/`GITHUB_TOKEN` — gh holds the credentials. No timers, no
 * retries: every call is one explicit verb invocation.
 */
import { parsePrRecord, type PrRecord } from '@tasks/domain';
import { bunRunner, type ProcessRunner } from '@tasks/git';
import { MessageError } from './errors.js';

export const GH_NOT_FOUND = 'gh not found — install GitHub CLI (https://cli.github.com) or set TK_GH';

/** `TK_GH` when non-empty (test/host override), else `gh` from PATH. */
export const ghBinary = (): string => {
  const override = process.env['TK_GH'];
  return override !== undefined && override.trim() !== '' ? override : 'gh';
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** First non-empty stderr line with control characters stripped (never the whole stream). */
const firstLine = (text: string): string => (text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '').replace(CONTROL, '').trim();

/** Runs `gh <args>`; returns stdout. 127 → not found; other non-zero → `gh <a0> <a1> failed: <first stderr line>`. */
export const runGh = async (args: readonly string[], cwd: string, runner: ProcessRunner = bunRunner): Promise<string> => {
  const result = await runner.run([ghBinary(), ...args], cwd);
  if (result.code === 127) throw new MessageError(GH_NOT_FOUND);
  if (result.code !== 0) {
    const detail = firstLine(result.stderr) || firstLine(result.stdout) || `exit ${result.code}`;
    throw new MessageError(`gh ${args.slice(0, 2).join(' ')} failed: ${detail}`);
  }
  return result.stdout;
};

const PR_FIELDS = 'number,url,state';
const UNEXPECTED = 'gh returned an unexpected PR payload';

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MessageError(UNEXPECTED);
  }
};

/** `gh pr view <ref> --json number,url,state` → a validated record (ref = number, url or branch). */
export const ghPrView = async (ref: string, cwd: string, runner: ProcessRunner = bunRunner): Promise<PrRecord> => {
  const record = parsePrRecord(parseJson(await runGh(['pr', 'view', ref, '--json', PR_FIELDS], cwd, runner)));
  if (record === null) throw new MessageError(UNEXPECTED);
  return record;
};

/** The open PR whose head is `branch`, or null: `gh pr list --head <branch> --state open --json … --limit 1`. */
export const ghPrListOpenForHead = async (branch: string, cwd: string, runner: ProcessRunner = bunRunner): Promise<PrRecord | null> => {
  const payload = parseJson(await runGh(['pr', 'list', '--head', branch, '--state', 'open', '--json', PR_FIELDS, '--limit', '1'], cwd, runner));
  if (!Array.isArray(payload)) throw new MessageError(UNEXPECTED);
  if (payload.length === 0) return null;
  const record = parsePrRecord(payload[0]);
  if (record === null) throw new MessageError(UNEXPECTED);
  return record;
};

export interface GhPrCreateInput {
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

/**
 * `gh pr create --head <h> --base <b> --title=<t> --body=<b>`, then `gh pr view <url>`.
 * Title/body use the single-token `--flag=<v>` form so a leading `-` can never become a flag (T-11-05).
 */
export const ghPrCreate = async (input: GhPrCreateInput, cwd: string, runner: ProcessRunner = bunRunner): Promise<PrRecord> => {
  const stdout = await runGh(['pr', 'create', '--head', input.head, '--base', input.base, `--title=${input.title}`, `--body=${input.body}`], cwd, runner);
  const url = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '').at(-1);
  if (url === undefined || !/^https?:\/\/\S+$/.test(url)) throw new MessageError(UNEXPECTED);
  return ghPrView(url, cwd, runner);
};

/** `gh pr close <n>` (11-03). Never passes `--delete-branch`: the branch is kept; pruning is `tk close`'s job. */
export const ghPrClose = async (number: number, cwd: string, runner: ProcessRunner = bunRunner): Promise<void> => {
  await runGh(['pr', 'close', String(number)], cwd, runner);
};

export type PrMergeMethod = 'merge' | 'squash' | 'rebase';
export const PR_MERGE_METHODS: readonly PrMergeMethod[] = ['merge', 'squash', 'rebase'];

/**
 * `gh pr merge <n> --<method>` (11-03). The method comes from a closed enum; never `--admin`
 * (bypasses branch protection, T-11-11) and never `--delete-branch` (the branch is kept).
 */
export const ghPrMerge = async (number: number, method: PrMergeMethod, cwd: string, runner: ProcessRunner = bunRunner): Promise<void> => {
  if (!PR_MERGE_METHODS.includes(method)) throw new MessageError(`unknown merge method: ${String(method)}`);
  await runGh(['pr', 'merge', String(number), `--${method}`], cwd, runner);
};
