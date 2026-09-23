import { resolve } from "node:path";

export type FlagValue = string | true | readonly string[];
export interface ParsedArgs { readonly positionals: readonly string[]; readonly flags: ReadonlyMap<string, FlagValue>; }

const aliases: Readonly<Record<string, string>> = { C: "directory", p: "priority", t: "type", d: "description" };
/** Flags that take a value: `--<flag> <value>` consumes the next token instead of marking a boolean. */
const valueFlags: Record<string, true> = {
  "directory": true, "prefix": true, "title": true, "description": true, "status": true, "priority": true, "type": true, "owner": true, "assignee": true, "due": true, "defer-until": true, "parent": true, "labels": true, "label": true, "notes": true, "design": true, "acceptance": true, "estimate": true, "spec-id": true, "external-ref": true, "metadata": true, "deps": true, "limit": true, "body": true, "actor": true, "until": true, "append-notes": true, "reason": true, "add-label": true, "remove-label": true, "set-metadata": true, "unset-metadata": true, "on-conflict": true, "bd": true, "source": true, "days": true, "depth": true, "min-similarity": true, "of": true, "with": true, "field": true, "editor": true, "backend": true, "filename": true, "url-env": true, "branch": true, "attach": true, "attach-metadata": true, "plan": true, "detach": true, "install": true, "port": true, "sprint": true, "runtime": true, "access": true, "mode": true, "instructions": true, "name": true, "state": true, "issue": true, "skill": true, "env": true,
};
/** Flags that may repeat: each occurrence appends instead of replacing. */
const appendableFlags: Record<string, true> = { "attach": true, "skill": true, "env": true };

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
    if (inline !== undefined) { setOrAppend(flags, name, inline); continue; }
    if (valueFlags[name] === true) {
      const next = tokens[index + 1];
      if (next === undefined || next.startsWith("-")) throw new ArgumentParseError(`--${name} requires value`);
      setOrAppend(flags, name, next); index += 1;
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
/** Repeatable flags accumulate string values; everything else replaces. */
const setOrAppend = (flags: Map<string, FlagValue>, name: string, value: string): void => {
  if (appendableFlags[name] !== true) { flags.set(name, value); return; }
  const existing = flags.get(name);
  if (existing === undefined) flags.set(name, value);
  else if (Array.isArray(existing)) flags.set(name, [...existing, value]);
  else if (typeof existing === "string") flags.set(name, [existing, value]);
  else flags.set(name, value);
};
