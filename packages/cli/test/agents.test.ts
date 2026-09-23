import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunSchema, type Run } from "@tasks/domain";
import { FileAdapter } from "@tasks/file";

const executable = join(process.cwd(), "packages/cli/src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-cli-agents-")); workspaces.push(value); return value; }
function run(directory: string, args: readonly string[], input?: string): { readonly stdout: string; readonly stderr: string; readonly status: number } { const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdin: input === undefined ? undefined : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" }); return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode }; }
function json<T>(directory: string, args: readonly string[], input?: string): T { const result = run(directory, [...args, "--json"], input); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
type AgentWire = { readonly id: string; readonly name: string; readonly description: string; readonly owner: string | null; readonly runtime: string; readonly access: string; readonly mode: string; readonly status: string; readonly instructions: string; readonly skills: readonly string[]; readonly env: Record<string, string>; readonly archived_at: string | null };
type RunWire = { readonly id: string; readonly issue_id: string; readonly agent_id: string | null; readonly trigger: string; readonly state: string; readonly closed_at: string | null; readonly messages: readonly { readonly kind: string; readonly text: string }[] };
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

async function seedRun(dir: string, overrides: Partial<Run> & Pick<Run, "id" | "issueId">): Promise<void> { const at = new Date(); const candidate: Run = RunSchema.parse({ agentId: null, trigger: "manual", state: "queued", startedAt: null, closedAt: null, messages: [], usage: { tokens: null, cost: null }, createdAt: at, updatedAt: at, ...overrides }); const adapter = new FileAdapter({ dir: join(dir, ".tasks") }); const result = await adapter.withinTransaction(async (uow) => uow.saveRun(candidate)); if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result.error)}`); }

describe("tk agent", () => {
  it("create/get roundtrip with all field flags", () => {
    const directory = workspace(); json(directory, ["init"]);
    const created = json<AgentWire>(directory, ["agent", "create", "Code Reviewer", "--description", "reviews code", "--owner", "yuri", "--runtime", "claude", "--access", "project", "--mode", "autopilot", "--instructions", "be terse", "--skill", "review", "--skill", "testing", "--env", "KEY=value", "--env", "OTHER=x"]);
    expect(created.id).toBe("code-reviewer"); expect(created.name).toBe("Code Reviewer"); expect(created.description).toBe("reviews code"); expect(created.owner).toBe("yuri"); expect(created.runtime).toBe("claude"); expect(created.access).toBe("project"); expect(created.mode).toBe("autopilot"); expect(created.status).toBe("offline"); expect(created.instructions).toBe("be terse"); expect(created.skills).toEqual(["review", "testing"]); expect(created.env).toEqual({ KEY: "value", OTHER: "x" });
    const fetched = json<AgentWire>(directory, ["agent", "get", created.id]);
    expect(fetched).toEqual(created);
  });

  it("rejects duplicate slug", () => {
    const directory = workspace(); json(directory, ["init"]);
    json<AgentWire>(directory, ["agent", "create", "Scout"]);
    const again = run(directory, ["agent", "create", "Scout"]);
    expect(again.status).not.toBe(0); expect(again.stderr).toContain("already exists");
  });

  it("updates fields and bumps updatedAt", () => {
    const directory = workspace(); json(directory, ["init"]);
    const created = json<AgentWire>(directory, ["agent", "create", "Worker", "--description", "before"]);
    const updated = json<AgentWire>(directory, ["agent", "update", created.id, "--description", "after", "--mode", "autopilot"]);
    expect(updated.description).toBe("after"); expect(updated.mode).toBe("autopilot"); expect(updated.name).toBe("Worker"); expect(updated.updated_at >= created.updated_at).toBe(true);
    const missing = run(directory, ["agent", "update", created.id]);
    expect(missing.status).not.toBe(0);
  });

  it("archive/unarchive roundtrip and list filtering", () => {
    const directory = workspace(); json(directory, ["init"]);
    json<AgentWire>(directory, ["agent", "create", "Active"]); json<AgentWire>(directory, ["agent", "create", "Retired"]);
    const archived = json<AgentWire>(directory, ["agent", "archive", "retired"]);
    expect(archived.status).toBe("offline"); expect(archived.archived_at).not.toBeNull();
    const listed = json<readonly AgentWire[]>(directory, ["agent", "list"]);
    expect(listed.map((agent) => agent.id)).toEqual(["active"]);
    const archivedOnly = json<readonly AgentWire[]>(directory, ["agent", "list", "--archived"]);
    expect(archivedOnly.map((agent) => agent.id)).toEqual(["retired"]);
    const unarchived = json<AgentWire>(directory, ["agent", "unarchive", "retired"]);
    expect(unarchived.status).toBe("offline"); expect(unarchived.archived_at).toBeNull();
    expect(json<readonly AgentWire[]>(directory, ["agent", "list"]).map((agent) => agent.id)).toEqual(["active", "retired"]);
  });

  it("copies fields except identity, status, and archivedAt", () => {
    const directory = workspace(); json(directory, ["init"]);
    const source = json<AgentWire>(directory, ["agent", "create", "Reviewer", "--description", "reviews", "--owner", "yuri", "--mode", "autopilot", "--skill", "review"]);
    json<AgentWire>(directory, ["agent", "archive", source.id]);
    const copy = json<AgentWire>(directory, ["agent", "copy", source.id, "--name", "Second Reviewer"]);
    expect(copy.id).toBe("second-reviewer"); expect(copy.name).toBe("Second Reviewer"); expect(copy.status).toBe("offline"); expect(copy.archived_at).toBeNull(); expect(copy.description).toBe("reviews"); expect(copy.owner).toBe("yuri"); expect(copy.mode).toBe("autopilot"); expect(copy.skills).toEqual(["review"]);
    const conflict = run(directory, ["agent", "copy", source.id, "--name", "Second Reviewer"]);
    expect(conflict.status).not.toBe(0);
  });

  it("agent issues lists only issues assigned to the agent", () => {
    const directory = workspace(); json(directory, ["init"]);
    const agent = json<AgentWire>(directory, ["agent", "create", "Watcher"]);
    const mine = json<{ readonly id: string }>(directory, ["create", "assigned work", "--assignee", agent.id]);
    json<{ readonly id: string }>(directory, ["create", "other work"]);
    expect(json<readonly { readonly id: string }[]>(directory, ["agent", "issues", agent.id])).toEqual([mine]);
  });
});

describe("tk runs", () => {
  it("lists runs with issue and state filters", async () => {
    const directory = workspace(); json(directory, ["init"]);
    const issueA = json<{ readonly id: string }>(directory, ["create", "issue a"]).id; const issueB = json<{ readonly id: string }>(directory, ["create", "issue b"]).id;
    await seedRun(directory, { id: "a-run-1", issueId: issueA, state: "queued" });
    await seedRun(directory, { id: "a-run-2", issueId: issueA, state: "running", agentId: "reviewer" });
    await seedRun(directory, { id: "b-run-1", issueId: issueB, state: "done" });
    const all = json<readonly RunWire[]>(directory, ["runs"]);
    expect(all.map((item) => item.id).sort()).toEqual(["a-run-1", "a-run-2", "b-run-1"]);
    expect(json<readonly RunWire[]>(directory, ["runs", "--issue", issueA]).map((item) => item.id).sort()).toEqual(["a-run-1", "a-run-2"]);
    expect(json<readonly RunWire[]>(directory, ["runs", "--state", "running"]).map((item) => item.id)).toEqual(["a-run-2"]);
  });

  it("show returns full run with messages and usage", async () => {
    const directory = workspace(); json(directory, ["init"]);
    const issue = json<{ readonly id: string }>(directory, ["create", "watched"]).id;
    const at = new Date(); const candidate: Run = RunSchema.parse({ id: "issue-run-1", issueId: issue, agentId: "reviewer", trigger: "wakeup", state: "running", startedAt: at, closedAt: null, messages: [{ at, kind: "log", text: "started" }], usage: { tokens: 1200, cost: null }, createdAt: at, updatedAt: at });
    const adapter = new FileAdapter({ dir: join(directory, ".tasks") }); const saved = await adapter.withinTransaction(async (uow) => uow.saveRun(candidate)); if (!saved.ok) throw new Error(`seed failed: ${JSON.stringify(saved.error)}`);
    const shown = json<RunWire>(directory, ["run", "show", "issue-run-1"]);
    expect(shown.state).toBe("running"); expect(shown.trigger).toBe("wakeup"); expect(shown.agent_id).toBe("reviewer"); expect(shown.messages).toEqual([{ at: at.toISOString(), kind: "log", text: "started" }]);
  });

  it("cancel transitions only active runs and sets closedAt", async () => {
    const directory = workspace(); json(directory, ["init"]);
    const issue = json<{ readonly id: string }>(directory, ["create", "cancel target"]).id;
    await seedRun(directory, { id: "x-run-1", issueId: issue }); await seedRun(directory, { id: "x-run-2", issueId: issue, state: "done" });
    const cancelled = json<RunWire>(directory, ["run", "cancel", "x-run-1"]);
    expect(cancelled.state).toBe("cancelled"); expect(cancelled.closed_at).not.toBeNull();
    const terminal = run(directory, ["run", "cancel", "x-run-2"]);
    expect(terminal.status).not.toBe(0); expect(terminal.stderr).toContain("not active");
  });

  it("rerun queues a fresh run with the next id for the issue", async () => {
    const directory = workspace(); json(directory, ["init"]);
    const issue = json<{ readonly id: string }>(directory, ["create", "rerun target"]).id;
    await seedRun(directory, { id: `${issue}-run-1`, issueId: issue, state: "failed", agentId: "reviewer", messages: [{ at: new Date(), kind: "log", text: "boom" }] });
    const rerun = json<RunWire>(directory, ["run", "rerun", `${issue}-run-1`]);
    expect(rerun.id).toBe(`${issue}-run-2`); expect(rerun.issue_id).toBe(issue); expect(rerun.agent_id).toBe("reviewer"); expect(rerun.trigger).toBe("manual"); expect(rerun.state).toBe("queued"); expect(rerun.messages).toEqual([]); expect(rerun.closed_at).toBeNull();
    const again = json<RunWire>(directory, ["run", "rerun", `${issue}-run-1`]);
    expect(again.id).toBe(`${issue}-run-3`);
  });

  it("message appends a log entry only while the run is non-terminal", async () => {
    const directory = workspace(); json(directory, ["init"]);
    const issue = json<{ readonly id: string }>(directory, ["create", "message target"]).id;
    await seedRun(directory, { id: "m-run-1", issueId: issue }); await seedRun(directory, { id: "m-run-2", issueId: issue, state: "cancelled" });
    const logged = json<RunWire>(directory, ["run", "message", "m-run-1", "first log line"]);
    expect(logged.messages).toHaveLength(1); expect(logged.messages[0].kind).toBe("log"); expect(logged.messages[0].text).toBe("first log line");
    const viaStdin = json<RunWire>(directory, ["run", "message", "m-run-1", "--stdin"], "piped log line\n");
    expect(viaStdin.messages.map((message) => message.text)).toEqual(["first log line", "piped log line"]);
    const terminal = run(directory, ["run", "message", "m-run-2", "late"]);
    expect(terminal.status).not.toBe(0); expect(terminal.stderr).toContain("terminal");
  });
});