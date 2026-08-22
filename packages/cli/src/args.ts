import { resolve } from "node:path";

export type FlagValue = string | true;
export interface ParsedArgs { readonly positionals: readonly string[]; readonly flags: ReadonlyMap<string, FlagValue>; }

const aliases: Readonly<Record<string, string>> = { C: "directory", p: "priority", t: "type", d: "description" };
const valueFlags = new Set([
  "directory", "prefix", "title", "description", "status", "priority", "type", "owner", "assignee", "due", "defer-until", "parent", "labels", "label", "notes", "design", "acceptance", "estimate", "spec-id", "external-ref", "metadata", "deps", "limit", "body", "actor", "until", "append-notes", "reason", "add-label", "remove-label", "set-metadata", "unset-metadata",
]);

export class ArgumentParseError extends Error {
  constructor(message: string) { super(message); this.name = "ArgumentParseError"; }
}

export function parseArgs(tokens: readonly string[]): ParsedArgs {
  const flags = new Map<string, FlagValue>();
  const positionals: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--") { positionals.push(...tokens.slice(index + 1)); break; }
    if (!token.startsWith("-") || token === "-") { positionals.push(token); continue; }
    const raw = token.startsWith("--") ? token.slice(2) : token.slice(1);
    const [rawName, inline] = raw.split("=", 2);
    const name = aliases[rawName!] ?? rawName!;
    if (inline !== undefined) { flags.set(name, inline); continue; }
    if (valueFlags.has(name)) {
      const next = tokens[index + 1];
      if (next === undefined || next.startsWith("-")) throw new ArgumentParseError(`--${name} requires value`);
      flags.set(name, next); index += 1;
    } else flags.set(name, true);
  }
  return { positionals, flags };
}
export const flag = (args: ParsedArgs, name: string): FlagValue | undefined => args.flags.get(name);
export const stringFlag = (args: ParsedArgs, name: string): string | undefined => {
  const value = flag(args, name); return typeof value === "string" ? value : undefined;
};
export const booleanFlag = (args: ParsedArgs, name: string): boolean => flag(args, name) === true;
export const directory = (args: ParsedArgs, fallback: string): string => resolve(stringFlag(args, "directory") ?? fallback);
