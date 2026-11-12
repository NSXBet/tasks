import type { WatchEvent } from "@tasks/surface";

/**
 * Status-bar notifications from the event log (D-03, WIRE-03). Pure: maps one
 * `WatchEvent` to the toast text, or null when the event is not worth a toast.
 * Every user-authored field passes through `sanitize`, so a comment body can
 * never put escape sequences on the terminal (T-10-26).
 */

/** Max cells of a comment body in a toast, ellipsis included. */
export const TOAST_BODY_MAX = 60;

// ANSI CSI (ESC [ … final) and OSC (ESC ] … BEL | ESC \) sequences, then any lone ESC + one char.
const ESCAPE_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-_]?/g;
// Remaining C0 controls, DEL and C1 controls.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Strips ANSI escape sequences and C0/C1 control characters; whitespace controls become one space. */
export const sanitize = (value: string): string =>
  value
    .replace(ESCAPE_SEQUENCE, "")
    .replace(/[\t\n\r\v\f]+/g, " ")
    .replace(CONTROL, "")
    .replace(/ {2,}/g, " ")
    .trim();

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const text = (value: unknown): string | null =>
  typeof value === "string" ? sanitize(value) : typeof value === "number" ? String(value) : null;

const STATUS_TOASTS: Readonly<Record<string, string>> = {
  "ready-to-review": "ready for review",
  approved: "approved",
  rejected: "rejected",
};

const reviewLocation = (data: Readonly<Record<string, unknown>>): string | null => {
  const file = text(data["file"]);
  const line = text(data["line"]);
  if (file !== null && file !== "") return line !== null && line !== "" ? `${file}:${line}` : file;
  const location = text(data["location"]);
  return location !== null && location !== "" ? location : null;
};

/** Toast text for one log event, or null. */
export const eventToast = (event: WatchEvent): string | null => {
  const id = text(event.issueId);
  if (id === null || id === "") return null;
  const data = (event.data ?? {}) as Readonly<Record<string, unknown>>;
  if (event.kind === "task.status") {
    const to = typeof data["to"] === "string" ? STATUS_TOASTS[data["to"]] : undefined;
    return to === undefined ? null : `${id} ${to}`;
  }
  if (event.kind === "task.comment") {
    if (data["kind"] === "note") {
      const author = text(data["author"]) || text(data["actor"]) || "someone";
      const body = truncate(text(data["body"]) ?? "", TOAST_BODY_MAX);
      return `${id} · ${author}: ${body}`;
    }
    if (data["kind"] === "review") {
      if (data["to"] === "open") {
        const where = reviewLocation(data);
        return where === null ? `${id} · review comment` : `${id} · review comment at ${where}`;
      }
      if (data["to"] === "sent") return `${id} · review comment sent`;
    }
  }
  return null;
};

/**
 * Collapses the toasts of one debounce window: the last one wins, with
 * ` (+N)` when N earlier ones were dropped.
 */
export const collapseToasts = (toasts: readonly string[]): string | null => {
  const last = toasts.at(-1);
  if (last === undefined) return null;
  return toasts.length > 1 ? `${last} (+${toasts.length - 1})` : last;
};
