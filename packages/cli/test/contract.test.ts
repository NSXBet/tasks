/**
 * The workflow contract is injected into agents through several surfaces:
 * the `tk onboard` managed block (AGENTS.md), `tk prime` (SessionStart hook),
 * the shipped SKILL.md copies, and this repo's own AGENTS.md. This test keeps
 * them saying the same thing, so drift in any one of them fails CI.
 */
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HUMAN_HELP } from "../src/presentation.js";

const repo = join(import.meta.dir, "../../..");
const executable = join(import.meta.dir, "../src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-contract-")); workspaces.push(value); return value; }
function run(directory: string, args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");
const read = (relative: string): string => readFileSync(join(repo, relative), "utf8");

/** The four contract clauses plus the review-wait commands the stat card reprint (11-01) and the PR verb (11-02) as they exist now. */
const CONTRACT: readonly (string | RegExp)[] = [
  "tk work <id>",
  "tk finish <id> --session",
  /never mark done/i,
  "tk review <id>",
  "tk watch <id> --until",
  "tk comments",
  "tk changes <id>",
  "tk pr create <id>",
  "tk pr merge <id>",
];
const LIFECYCLE = "tk worktree clean";
/** The bold contract line is shared verbatim by the template and every SKILL.md copy. */
const CONTRACT_LINE = /^\*\*The contract:.*\*\*$/m;

function expectContract(text: string, label: string): void {
  for (const clause of CONTRACT) {
    const ok = typeof clause === "string" ? text.includes(clause) : clause.test(text);
    expect(ok, `${label} is missing contract clause ${String(clause)}`).toBe(true);
  }
}

const SURFACES = {
  template: "packages/cli/templates/agents/tk-section.md",
  cliSkill: "packages/cli/skills/tasks/SKILL.md",
  piSkill: "packages/pi-extention/skills/tasks/SKILL.md",
  projectSkill: ".agents/skills/tasks/SKILL.md",
  rootAgents: "AGENTS.md",
} as const;

/** The pi copy swaps step 5's indented wait paragraph (shell `tk watch`) for the tasks_wait tool + inbox; everything else is shared. */
const withoutWaitParagraph = (text: string): string => text.replace(/(\n5\. \*\*Hand over\.\*\*[^\n]*\n)(?: {3}[^\n]*\n)+/, "$1");

describe("workflow contract across injection surfaces", () => {
  it("fresh clone → tk onboard install writes one idempotent managed block stating the contract", () => {
    const dir = workspace();
    expect(Bun.spawnSync(["git", "init", "-q", dir]).exitCode).toBe(0);
    const first = run(dir, ["onboard", "install"]);
    expect(first.status, first.stderr).toBe(0);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(content.split("<!-- BEGIN TK INTEGRATION").length - 1).toBe(1);
    expect(content.split("<!-- END TK INTEGRATION -->").length - 1).toBe(1);
    expectContract(content, "fresh-clone AGENTS.md");
    expect(content).toContain(LIFECYCLE);
    expect(content).toMatch(CONTRACT_LINE);
    const second = run(dir, ["onboard", "install"]);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(content);
  });

  it("tk prime states the contract and the lifecycle line", () => {
    const result = run(repo, ["prime"]);
    expect(result.status, result.stderr).toBe(0);
    const text = stripAnsi(result.stdout);
    expectContract(text, "tk prime");
    expect(text).toContain(LIFECYCLE);
  });

  it("template, every SKILL.md copy, and root AGENTS.md state the contract", () => {
    for (const [label, path] of Object.entries(SURFACES)) expectContract(read(path), label);
    const line = read(SURFACES.template).match(CONTRACT_LINE)?.[0];
    expect(line, "template has the bold contract line").toBeDefined();
    for (const [label, path] of Object.entries(SURFACES)) expect(read(path), `${label} contract line`).toContain(line!);
    for (const path of [SURFACES.template, SURFACES.cliSkill, SURFACES.piSkill]) expect(read(path), path).toContain(LIFECYCLE);
  });

  it("skill copies match the CLI skill (project copy byte-for-byte; pi copy except its wait paragraph)", () => {
    const cli = read(SURFACES.cliSkill);
    expect(read(SURFACES.projectSkill)).toBe(cli);
    const pi = read(SURFACES.piSkill);
    expect(pi).toContain("tasks_wait");
    expect(withoutWaitParagraph(pi)).toBe(withoutWaitParagraph(cli));
  });

  it("root AGENTS.md managed block is current", () => {
    const result = run(repo, ["onboard", "check"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("stale");
  });

  it("no surface mentions the removed tk hunk command; help has no WIP mock labels", () => {
    const prime = stripAnsi(run(repo, ["prime"]).stdout);
    for (const [label, text] of [...Object.entries(SURFACES).map(([label, path]) => [label, read(path)] as const), ["prime", prime] as const]) {
      expect(text, label).not.toMatch(/\btk hunk\b/);
    }
    expect(stripAnsi(HUMAN_HELP)).not.toContain("WIP mock");
    expect(run(workspace(), ["help"]).stdout).not.toContain("WIP mock");
  });
});
