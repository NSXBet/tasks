import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const executable = join(import.meta.dir, "../../cli/src/tk.ts");
const workspaces: string[] = [];
function workspace(): string { const value = mkdtempSync(join(tmpdir(), "tk-onboard-")); workspaces.push(value); return value; }
function run(directory: string, args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = Bun.spawnSync([process.execPath, executable, "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" });
  return { stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr), status: result.exitCode };
}
function json<T>(directory: string, args: readonly string[]): T { const result = run(directory, [...args, "--json"]); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as T; }
function jsonLoose<T>(directory: string, args: readonly string[]): T { return JSON.parse(run(directory, [...args, "--json"]).stdout) as T; }
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

const beginMarker = "<!-- BEGIN TK INTEGRATION";
const endMarker = "<!-- END TK INTEGRATION -->";

function sectionBounds(content: string): readonly [number, number] {
  const begin = content.indexOf(beginMarker);
  const end = content.indexOf(endMarker) + endMarker.length;
  return [begin, end];
}

/** Body between the marker lines, as parsed by render.go's contract. */
function sectionBody(content: string): string {
  const [begin, end] = sectionBounds(content);
  const firstNewline = content.indexOf("\n", begin);
  return content.slice(firstNewline + 1, content.indexOf("\n", content.indexOf(endMarker) - 1));
}

describe("tk onboard (managed instruction-file block, beads contracts)", () => {
  it("bare onboard prints the section body without markers; --json wraps it", () => {
    const dir = workspace();
    const plain = run(dir, ["onboard"]);
    expect(plain.status).toBe(0);
    expect(plain.stdout).toContain("## Tasks Issue Tracker");
    expect(plain.stdout).not.toContain("BEGIN TK INTEGRATION");
    expect(plain.stdout.endsWith("\n")).toBe(true);
    const wrapped = json<{ text: string }>(dir, ["onboard"]);
    expect(wrapped.text).toContain("## Tasks Issue Tracker");
  });

  it("install into an empty dir scaffolds AGENTS.md with versioned, hash-stamped markers", () => {
    const dir = workspace();
    const result = json<{ file: string; action: string }>(dir, ["onboard", "install"]);
    expect(result).toEqual({ file: join(dir, "AGENTS.md"), action: "created" });
    const content = readFileSync(join(dir, "AGENTS.md"), "utf8");
    const match = content.match(/<!-- BEGIN TK INTEGRATION v:1 hash:([0-9a-f]{8}) -->/);
    expect(match).not.toBeNull();
    // hash = first 8 hex of sha256 of the body (render.go computeHash)
    expect(match![1]).toBe(createHash("sha256").update(sectionBody(content)).digest("hex").slice(0, 8));
    expect(content).toContain("tk create");
    expect(content).toContain("print a work-done summary");
    expect(content.startsWith("# Project Instructions for AI Agents")).toBe(true);
  });

  it("install preserves user content; reinstall is a byte-identical no-op (hash-current skip)", () => {
    const dir = workspace();
    const file = join(dir, "AGENTS.md");
    writeFileSync(file, "# My Project\n\nOwn setup notes.\n");
    expect(json<{ action: string }>(dir, ["onboard", "install"]).action).toBe("added");
    const afterFirst = readFileSync(file, "utf8");
    expect(afterFirst).toContain("# My Project");
    expect(afterFirst).toContain("Own setup notes.");
    expect(afterFirst.match(/BEGIN TK INTEGRATION/g)).toHaveLength(1);

    const second = json<{ action: string }>(dir, ["onboard", "install"]);
    expect(second.action).toBe("updated");
    const afterSecond = readFileSync(file, "utf8");
    expect(afterSecond.match(/BEGIN TK INTEGRATION/g)).toHaveLength(1);
    expect(afterSecond === afterFirst).toBe(true); // hash-current: no bytes rewritten
  });

  it("check exits 0 only when current; missing/no-section/stale exit 1", () => {
    const dir = workspace();
    expect(run(dir, ["onboard", "check"]).status).not.toBe(0); // missing
    expect(jsonLoose<{ file: string; state: string }>(dir, ["onboard", "check"]).state).toBe("missing");
    expect(json<{ file: string; state: string }>(dir, ["onboard", "install"]).action).toBe("created");
    expect(json<{ file: string; state: string }>(dir, ["onboard", "check"])).toEqual({ file: join(dir, "AGENTS.md"), state: "current" });
    expect(run(dir, ["onboard", "check"]).status).toBe(0);

    // Tampering with the body makes it stale; install restores it.
    const file = join(dir, "AGENTS.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/hash:[0-9a-f]{8}/, "hash:deadbeef"));
    expect(jsonLoose<{ file: string; state: string }>(dir, ["onboard", "check"]).state).toBe("stale");
    expect(run(dir, ["onboard", "check"]).status).not.toBe(0);
    expect(json<{ action: string }>(dir, ["onboard", "install"]).action).toBe("updated");
    expect(json<{ file: string; state: string }>(dir, ["onboard", "check"]).state).toBe("current");

    // An AGENTS.md without any section: no-section.
    writeFileSync(file, "plain file\n");
    expect(jsonLoose<{ file: string; state: string }>(dir, ["onboard", "check"]).state).toBe("no-section");
  });

  it("legacy unversioned markers parse as stale and splice correctly", () => {
    const dir = workspace();
    const file = join(dir, "AGENTS.md");
    const body = json<{ text: string }>(dir, ["onboard"]).text;
    writeFileSync(file, `# Mine\n\n${beginMarker} -->\n${body}\n${endMarker}\n`);
    expect(jsonLoose<{ file: string; state: string }>(dir, ["onboard", "check"]).state).toBe("stale");
    expect(json<{ action: string }>(dir, ["onboard", "install"]).action).toBe("updated");
    const after = readFileSync(file, "utf8");
    expect(after).toContain("v:1 hash:");
    expect(after).toContain("# Mine");
    expect(after.match(/BEGIN TK INTEGRATION/g)).toHaveLength(1);
  });

  it("remove strips only the managed section and is a clean no-op otherwise", () => {
    const dir = workspace();
    const file = join(dir, "AGENTS.md");
    writeFileSync(file, "# My Project\n\nOwn setup notes.\n");
    json<unknown>(dir, ["onboard", "install"]);
    const result = json<{ file: string; removed: boolean }>(dir, ["onboard", "remove"]);
    expect(result.removed).toBe(true);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("# My Project");
    expect(after).toContain("Own setup notes.");
    expect(after).not.toContain("BEGIN TK INTEGRATION");
    expect(after).not.toContain("END TK INTEGRATION");
    expect(after).not.toContain("Tasks Issue Tracker");
    // Removing again: clean no-op (beads contract), not an error.
    expect(json<{ file: string; removed: boolean }>(dir, ["onboard", "remove"]).removed).toBe(false);
  });

  it("user content outside the markers survives reinstall byte-for-byte, including leading blank lines", () => {
    const dir = workspace();
    const file = join(dir, "AGENTS.md");
    writeFileSync(file, "# Header\n\n> note\n");
    json<unknown>(dir, ["onboard", "install"]);
    const withSection = readFileSync(file, "utf8");
    json<unknown>(dir, ["onboard", "install"]);
    expect(readFileSync(file, "utf8")).toBe(withSection);
    expect(withSection.startsWith("# Header\n\n> note\n")).toBe(true);
  });

  it("BEGIN without END is malformed and install refuses to rewrite", () => {
    const dir = workspace();
    const file = join(dir, "AGENTS.md");
    writeFileSync(file, `${beginMarker} -->\nno end marker here\n`);
    const result = run(dir, ["onboard", "install"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("malformed");
    expect(readFileSync(file, "utf8")).toBe(`${beginMarker} -->\nno end marker here\n`);
  });

  it("--file targets a custom instruction file; default AGENTS.md untouched", () => {
    const dir = workspace();
    expect(json<{ file: string; action: string }>(dir, ["onboard", "install", "--file", "docs/CLAUDE.md"]).file).toBe(join(dir, "docs", "CLAUDE.md"));
    expect(readFileSync(join(dir, "docs", "CLAUDE.md"), "utf8")).toContain(beginMarker);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("--tool claude targets CLAUDE.md; unknown tool errors", () => {
    const dir = workspace();
    expect(json<{ file: string }>(dir, ["onboard", "install", "--tool", "claude"]).file).toBe(join(dir, "CLAUDE.md"));
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain(beginMarker);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    const bad = run(dir, ["onboard", "install", "--tool", "editor"]);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("unknown --tool");
  });
});
