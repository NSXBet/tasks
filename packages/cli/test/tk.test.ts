import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(process.cwd(), "packages/cli/src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-cli-")); workspaces.push(value); return value; }
function run(directory: string, args: readonly string[], input?: string): { readonly stdout: string; readonly stderr: string; readonly status: number } { const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdin: input === undefined ? undefined : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" }); return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode }; }
function json<T>(directory: string, args: readonly string[], input?: string): T { const result = run(directory, [...args, "--json"], input); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

describe("tk executable", () => {
  it("supports conductor list, show, comment and close paths", () => { const directory = workspace(); json(directory, ["init", "--prefix", "tk"]); const epic = json<{ id: string }>(directory, ["create", "epic", "--type", "epic"]); const child = json<{ id: string }>(directory, ["create", "child", "--parent", epic.id]); expect(json<readonly { id: string }[]>(directory, ["list", "--parent", epic.id])).toHaveLength(1); expect(json<readonly { id: string }[]>(directory, ["show", child.id])[0]!.id).toBe(child.id); expect(json<{ comments: readonly { text: string }[] }>(directory, ["comment", child.id, "--body", "note"]).comments[0]!.text).toBe("note"); expect(json<{ status: string }>(directory, ["close", child.id]).status).toBe("closed"); });
  it("supports tuicr workspace, current, comments, dependencies, lifecycle and edits", () => { const directory = workspace(); json(directory, ["init"]); const first = json<{ id: string }>(directory, ["create", "first"]); const second = json<{ id: string }>(directory, ["create", "second"]); expect(json<{ workspace: string }>(directory, ["where"]).workspace).toBe(directory); expect(json<readonly { id: string }[]>(directory, ["show", "--current"])[0]!.id).toBe(second.id); json(directory, ["comment", "--current", "--stdin"], "stdin note"); expect(json<readonly { text: string }[]>(directory, ["comments", "--current"])[0]!.text).toBe("stdin note"); expect(json<readonly { id: string }[]>(directory, ["list"])).toHaveLength(2); json(directory, ["dep", second.id, "add", first.id]); expect(json<readonly { id: string }[]>(directory, ["dep", second.id, "list"])[0]!.id).toBe(first.id); json(directory, ["dep", second.id, "remove", first.id]); json(directory, ["dep", second.id, "relate", first.id]); json(directory, ["dep", second.id, "unrelate", first.id]); expect(json<{ status: string }>(directory, ["set-state", second.id, "in_progress"]).status).toBe("in_progress"); expect(json<{ title: string; description: string }>(directory, ["update", second.id, "--title", "edited", "--body", "body"]).title).toBe("edited"); expect(json<{ status: string }>(directory, ["close", second.id]).status).toBe("closed"); expect(json<{ status: string }>(directory, ["reopen", second.id]).status).toBe("open"); });
  it("creates from title flag without positional while keeping positional title", () => { const directory = workspace(); json(directory, ["init"]); expect(json<{ title: string }>(directory, ["create", "--title", "flag title"]).title).toBe("flag title"); expect(json<{ title: string }>(directory, ["create", "positional title"]).title).toBe("positional title"); });
  it("classifies argument-parser failures with JSON error envelope", () => { const directory = workspace(); const result = run(directory, ["create", "--title", "--json"]); expect(result.status).not.toBe(0); expect(JSON.parse(result.stderr)).toEqual({ error: { kind: "parse", message: "--title requires value" } }); });
  it("blocks writes in readonly mode with JSON error envelope", () => { const directory = workspace(); json(directory, ["init"]); const result = run(directory, ["create", "blocked", "--readonly", "--json"]); expect(result.status).not.toBe(0); expect(JSON.parse(result.stderr)).toEqual({ error: { kind: "readonly", message: "readonly mode blocks writes" } }); });

  it("readonly queries require current schema and never migrate", () => { const directory = workspace(); json(directory, ["init"]); expect(json<readonly unknown[]>(directory, ["list", "--readonly"])).toEqual([]); const result = run(directory, ["list", "--readonly"]); expect(result.status).toBe(0); });

  it("exports JSON array with --json and JSONL only to stdout otherwise", () => { const directory = workspace(); json(directory, ["init"]); const created = json<{ id: string }>(directory, ["create", "wire"]); const exported = json<readonly Record<string, unknown>[]>(directory, ["export"]); expect(exported).toHaveLength(1); expect(exported[0]!["id"]).toBe(created.id); const plain = run(directory, ["export"]); expect(plain.status, plain.stderr).toBe(0); expect(plain.stdout.trim()).toBe(JSON.stringify(exported[0])); expect(run(directory, ["migrate", "--json"]).status).not.toBe(0); });

  it("imports JSONL from stdin and returns only imported count", () => { const source = workspace(); const target = workspace(); json(source, ["init"]); json(source, ["create", "stdin wire"]); const input = run(source, ["export"]).stdout; json(target, ["init"]); expect(json<{ imported: number }>(target, ["import"], input)).toEqual({ imported: 1 }); expect(json<readonly Record<string, unknown>[]>(target, ["export"])).toHaveLength(1); });

  it("round-trips complete wire records and rolls back invalid nested input", () => { const source = workspace(); const target = workspace(); json(source, ["init"]); const created = json<{ id: string }>(source, ["create", "wire"]); const wire = json<readonly Record<string, unknown>[]>(source, ["export"])[0]!; wire["future_top"] = { keep: true }; (wire["dependencies"] as Record<string, unknown>[]).push({ issue_id: created.id, depends_on_id: "external:other:cap", type: "blocks", created_at: wire["created_at"], created_by: "actor", metadata: { nested: [1] }, future_edge: "yes" }); wire["dependency_count"] = 1; (wire["comments"] as Record<string, unknown>[]).push({ id: "external-comment", issue_id: created.id, author: "actor", text: "hi", created_at: wire["created_at"], future_comment: "yes" }); wire["comment_count"] = 1; json(target, ["init"]); expect(json<{ imported: number }>(target, ["import"], JSON.stringify(wire)).imported).toBe(1); expect(json<readonly Record<string, unknown>[]>(target, ["export"])[0]).toMatchObject(wire); const invalid = { ...wire, id: "tk-invalid", dependencies: [{ ...(wire["dependencies"] as Record<string, unknown>[])[0]!, created_at: "nope" }] }; const failed = run(target, ["import", "--json"], JSON.stringify(invalid)); expect(failed.status).not.toBe(0); expect(JSON.parse(failed.stderr).error.message).toMatch(/import line 1 field/); expect(json<readonly unknown[]>(target, ["list"])).toHaveLength(1); });

  it("imports JSONL from a redirected file, not only a pipe", () => {
    const directory = workspace();
    json(directory, ["init", "--prefix", "demo"]);
    const file = join(directory, "source.jsonl");
    writeFileSync(file, `${JSON.stringify({ _type: "issue", id: "demo-1", title: "redirected", status: "open", priority: 2, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" })}\n`);
    const result = Bun.spawnSync([process.execPath, executable, "-C", directory, "import", "--json"], { stdin: Bun.file(file), stdout: "pipe", stderr: "pipe" });
    expect(new TextDecoder().decode(result.stdout).trim()).toBe(JSON.stringify({ imported: 1 }));
    expect(json<readonly unknown[]>(directory, ["list"])).toHaveLength(1);
  });

  it("imports beads records that list a child before its parent", () => {
    const directory = workspace();
    json(directory, ["init", "--prefix", "demo"]);
    const at = "2026-01-01T00:00:00Z";
    const input = [
      JSON.stringify({ _type: "issue", id: "demo-2", title: "child", status: "open", priority: 2, parent: "demo-1", created_at: at, updated_at: at }),
      JSON.stringify({ _type: "issue", id: "demo-1", title: "parent", status: "open", priority: 2, created_at: at, updated_at: at }),
    ].join("\n");
    expect(json<{ imported: number }>(directory, ["import"], input)).toEqual({ imported: 2 });
    expect(json<readonly Record<string, unknown>[]>(directory, ["show", "demo-2"])[0]!["parent"]).toBe("demo-1");
  });

  it("preserves estimated_minutes across a beads import round trip", () => {
    const directory = workspace();
    json(directory, ["init", "--prefix", "demo"]);
    const at = "2026-01-01T00:00:00Z";
    json<{ imported: number }>(directory, ["import"], JSON.stringify({ _type: "issue", id: "demo-1", title: "rich", status: "open", priority: 2, estimated_minutes: 90, created_at: at, updated_at: at }));
    expect(json<readonly Record<string, unknown>[]>(directory, ["show", "demo-1"])[0]!["estimated_minutes"]).toBe(90);
  });

  it("migrates a beads workspace from issues.jsonl without touching the source", () => {
    const directory = workspace();
    const beads = join(directory, ".beads");
    mkdirSync(beads, { recursive: true });
    writeFileSync(join(beads, "metadata.json"), JSON.stringify({ backend: "dolt" }));
    const at = "2026-01-01T00:00:00Z";
    writeFileSync(join(beads, "issues.jsonl"), [
      JSON.stringify({ _type: "issue", id: "demo-2", title: "child", status: "open", priority: 2, parent: "demo-1", estimated_minutes: 30, created_at: at, updated_at: at }),
      JSON.stringify({ _type: "issue", id: "demo-1", title: "parent", status: "open", priority: 2, created_at: at, updated_at: at }),
      JSON.stringify({ _type: "memory", key: "k", value: "v" }),
    ].join("\n") + "\n");
    const report = json<Record<string, unknown>>(directory, ["migrate", "--source", "jsonl", "--prefix", "demo"]);
    expect(report).toMatchObject({ migrated: true, source: "jsonl", read: 3, imported: 2 });
    expect(report["carried"]).toEqual([{ line: 3, type: "memory" }]);
    // The beads workspace must survive migration so bd keeps working.
    expect(json<readonly Record<string, unknown>[]>(directory, ["show", "demo-2"])[0]).toMatchObject({ parent: "demo-1", estimated_minutes: 30 });
    expect(run(directory, ["where", "--json"]).status).toBe(0);
  });

  it("adopts the beads prefix so migrated and new issues share one ID space", () => {
    const directory = workspace();
    const beads = join(directory, ".beads");
    mkdirSync(beads, { recursive: true });
    const at = "2026-01-01T00:00:00Z";
    writeFileSync(join(beads, "issues.jsonl"), `${JSON.stringify({ _type: "issue", id: "proj-9xy", title: "migrated", status: "open", priority: 2, created_at: at, updated_at: at })}\n`);
    expect(json<Record<string, unknown>>(directory, ["migrate", "--source", "jsonl"])["prefix"]).toBe("proj");
    expect(json<Record<string, unknown>>(directory, ["where"])["prefix"]).toBe("proj");
    expect(String(json<Record<string, unknown>>(directory, ["create", "fresh"])["id"]).startsWith("proj-")).toBe(true);
  });

  it("honours --keep-prefix over the beads prefix", () => {
    const directory = workspace();
    json(directory, ["init", "--prefix", "mine"]);
    const beads = join(directory, ".beads");
    mkdirSync(beads, { recursive: true });
    const at = "2026-01-01T00:00:00Z";
    writeFileSync(join(beads, "issues.jsonl"), `${JSON.stringify({ _type: "issue", id: "proj-9xy", title: "migrated", status: "open", priority: 2, created_at: at, updated_at: at })}\n`);
    json(directory, ["migrate", "--source", "jsonl", "--keep-prefix"]);
    expect(json<Record<string, unknown>>(directory, ["where"])["prefix"]).toBe("mine");
  });

  it("creates no workspace at all when dry-running a beads-only checkout", () => {
    const directory = workspace();
    const beads = join(directory, ".beads");
    mkdirSync(beads, { recursive: true });
    const at = "2026-01-01T00:00:00Z";
    writeFileSync(join(beads, "issues.jsonl"), `${JSON.stringify({ _type: "issue", id: "proj-1", title: "dry", status: "open", priority: 2, created_at: at, updated_at: at })}\n`);
    expect(json<Record<string, unknown>>(directory, ["migrate", "--source", "jsonl", "--dry-run"])).toMatchObject({ dry_run: true, imported: 1 });
    expect(existsSync(join(directory, ".tasks"))).toBe(false);
  });

  it("reports a dry-run migration without writing", () => {
    const directory = workspace();
    json(directory, ["init", "--prefix", "demo"]);
    const beads = join(directory, ".beads");
    mkdirSync(beads, { recursive: true });
    const at = "2026-01-01T00:00:00Z";
    writeFileSync(join(beads, "issues.jsonl"), `${JSON.stringify({ _type: "issue", id: "demo-1", title: "dry", status: "open", priority: 2, created_at: at, updated_at: at })}\n`);
    expect(json<Record<string, unknown>>(directory, ["migrate", "--source", "jsonl", "--dry-run"])).toMatchObject({ migrated: false, dry_run: true, imported: 1 });
    expect(json<readonly unknown[]>(directory, ["list"])).toHaveLength(0);
  });

  it("skips already-migrated issues and re-runs idempotently", () => {
    const directory = workspace();
    const beads = join(directory, ".beads");
    mkdirSync(beads, { recursive: true });
    const at = "2026-01-01T00:00:00Z";
    writeFileSync(join(beads, "issues.jsonl"), `${JSON.stringify({ _type: "issue", id: "demo-1", title: "once", status: "open", priority: 2, created_at: at, updated_at: at })}\n`);
    json(directory, ["migrate", "--source", "jsonl", "--prefix", "demo"]);
    expect(json<Record<string, unknown>>(directory, ["migrate", "--source", "jsonl"])).toMatchObject({ imported: 0, skipped: ["demo-1"] });
    expect(json<readonly unknown[]>(directory, ["list"])).toHaveLength(1);
  });

  it("refuses an empty issues.jsonl instead of reporting a successful empty migration", () => {
    const directory = workspace();
    json(directory, ["init"]);
    const beads = join(directory, ".beads");
    mkdirSync(beads, { recursive: true });
    writeFileSync(join(beads, "issues.jsonl"), "");
    const result = run(directory, ["migrate", "--source", "jsonl", "--json"]);
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stderr).error.message).toContain("missing or empty");
  });

  it("points at migrate when only a beads workspace exists", () => {
    const directory = workspace();
    mkdirSync(join(directory, ".beads"), { recursive: true });
    const result = run(directory, ["list", "--json"]);
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stderr).error.message).toContain("tk migrate");
  });

  it("never escapes the repository into an unrelated parent workspace", () => {
    // An unbounded upward walk reaches $HOME, where a stray .tasks/ would
    // silently capture every repository on the machine.
    const outer = workspace();
    mkdirSync(join(outer, ".tasks"), { recursive: true });
    const inner = join(outer, "repo");
    mkdirSync(join(inner, ".git"), { recursive: true });
    const result = run(inner, ["list", "--json"]);
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stderr).error.message).toContain("run tk init");
  });

  it("still finds a workspace at the repository root from a nested directory", () => {
    const directory = workspace();
    mkdirSync(join(directory, ".git"), { recursive: true });
    json(directory, ["init", "--prefix", "demo"]);
    const nested = join(directory, "packages", "deep");
    mkdirSync(nested, { recursive: true });
    expect(json<Record<string, unknown>>(nested, ["where"])["workspace"]).toBe(directory);
  });

  it("supports exact tuicr dep, label, update and where JSON contracts", () => {
    const directory = workspace();
    json(directory, ["init", "--prefix", "tuicr"]);
    const blocker = json<{ id: string }>(directory, ["create", "blocker", "--type", "bug"]);
    const blocked = json<{ id: string }>(directory, ["create", "blocked", "--type", "task", "--parent", blocker.id]);
    json(directory, ["dep", "add", blocked.id, blocker.id]);
    const down = json<readonly Record<string, unknown>[]>(directory, ["dep", "list", blocked.id]);
    expect(down[0]).toEqual({ id: blocker.id, title: "blocker", status: "open", issue_type: "bug", dependency_type: "blocks" });
    const up = json<readonly Record<string, unknown>[]>(directory, ["dep", "list", blocker.id, "--direction=up"]);
    expect(up).toContainEqual({ id: blocked.id, title: "blocked", status: "open", issue_type: "task", dependency_type: "blocks" });
    expect(up).toContainEqual({ id: blocked.id, title: "blocked", status: "open", issue_type: "task", dependency_type: "parent-child" });
    json(directory, ["dep", "remove", blocked.id, blocker.id]);
    json(directory, ["dep", "relate", blocked.id, blocker.id]);
    expect(json<readonly Record<string, unknown>[]>(directory, ["dep", "list", blocked.id])[0]!["dependency_type"]).toBe("relates-to");
    json(directory, ["dep", "unrelate", blocked.id, blocker.id]);
    json(directory, ["label", "add", blocked.id, "red"]);
    json(directory, ["label", "remove", blocked.id, "red"]);
    const updated = json<Record<string, unknown>>(directory, ["update", blocked.id, "--add-label", "keep", "--remove-label", "red", "--set-metadata", "count=2", "--unset-metadata", "missing", "--assignee", "", "--parent", "", "--external-ref", ""]);
    expect(updated["labels"]).toEqual(["keep"]); expect(updated["metadata"]).toEqual({ count: 2 }); expect(updated["assignee"]).toBeNull(); expect(updated["parent"]).toBeNull(); expect(updated["external_ref"]).toBeNull(); expect(updated).toHaveProperty("estimated_minutes"); expect(updated).not.toHaveProperty("estimate");
    expect(json<Record<string, unknown>>(directory, ["where"])).toMatchObject({ path: join(directory, ".tasks"), prefix: "tuicr", database_path: join(directory, ".tasks", "tasks.db"), schema_version: 1 });
    expect(json<Record<string, unknown>>(directory, ["close", blocked.id, "--reason", "done"])["notes"]).toContain("done");
  });
});
