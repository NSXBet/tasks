import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startWebServer } from "../src/server";

const workspaces: string[] = [];
function workspace(): string {
  const value = mkdtempSync(join(tmpdir(), "tk-web-"));
  mkdirSync(join(value, ".beads"), { recursive: true });
  workspaces.push(value);
  return value;
}
const init = async (root: string): Promise<void> => {
  const result = Bun.spawnSync([process.execPath, join(process.cwd(), "packages/cli/src/tk.ts"), "-C", root, "init", "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
};
afterEach(() => { while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true }); });

describe("tk web server", () => {
  it("serves the shell and board API over a fresh workspace", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root });
    try {
      const shell = await fetch(`${server.url}/`);
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-type")).toContain("text/html");
      const body = new TextDecoder().decode(await shell.arrayBuffer());
      expect(body).toContain("<!doctype html");

      const board = await fetch(`${server.url}/api/board`);
      expect(board.status).toBe(200);
      const page = (await board.json()) as { readonly issues: readonly { readonly id: string }[]; readonly actor: string };
      expect(Array.isArray(page.issues)).toBe(true);
      expect(page.actor).toBe(process.env["USER"]);
    } finally {
      await server.close();
    }
  });

  it("creates an issue through the API and reads it back on the board", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root });
    try {
      const created = await fetch(`${server.url}/api/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "web-created", priority: 1 }) });
      expect(created.status).toBe(200);
      const { id } = (await created.json()) as { readonly id: string };
      expect(id).toBeTruthy();

      const board = await fetch(`${server.url}/api/board`);
      const page = (await board.json()) as { readonly issues: readonly { readonly id: string; readonly title: string }[] };
      const match = page.issues.find((issue) => issue.id === id);
      expect(match?.title).toBe("web-created");
    } finally {
      await server.close();
    }
  });

  it("updates status and title on an existing issue through the mutation route", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root });
    try {
      const created = await fetch(`${server.url}/api/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "mutable" }) });
      const { id } = (await created.json()) as { readonly id: string };

      const updated = await fetch(`${server.url}/api/issue/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "closed", title: "renamed" }) });
      expect(updated.status).toBe(200);

      const board = await fetch(`${server.url}/api/board`);
      const page = (await board.json()) as { readonly issues: readonly { readonly id: string; readonly title: string; readonly status: string }[] };
      const match = page.issues.find((issue) => issue.id === id);
      expect(match?.title).toBe("renamed");
      expect(match?.status).toBe("closed");
    } finally {
      await server.close();
    }
  });

  it("answers 404 JSON for unknown routes", async () => {
    const root = workspace();
    await init(root);
    const server = await startWebServer({ root });
    try {
      const missing = await fetch(`${server.url}/api/nope`);
      expect(missing.status).toBe(404);
      const error = (await missing.json()) as { readonly error: { readonly kind: string } };
      expect(error.error.kind).toBe("not_found");
    } finally {
      await server.close();
    }
  });
});
