/**
 * Minimal markdown shaping shared by the detail pane's description and the
 * artifact view's DOC mode: headers, list bullets, code fences, quotes, and
 * `evidence:<id>` refs as image lines. `MdLineView` (markdown-view.tsx)
 * renders one shaped line.
 */

export type MdLine = { readonly kind: "h" | "li" | "code" | "quote" | "img" | "text" | "blank"; readonly text: string };

/** An `evidence:<id>` ref exactly as produced by `tk attach` / comment ingest. */
export const EVIDENCE_CHUNK_RE = /^evidence:ev-[a-z0-9]{6}$/;

/** Minimal markdown shaping: headers, list bullets, code fences, quotes. Evidence refs become img lines. */
export const mdLines = (source: string): readonly MdLine[] => {
  const out: MdLine[] = [];
  let inCode = false;
  for (const chunk of source.split(/(evidence:ev-[a-z0-9]{6})/)) {
    if (EVIDENCE_CHUNK_RE.test(chunk)) { out.push({ kind: "img", text: chunk.slice("evidence:".length) }); continue; }
    for (const raw of chunk.split("\n")) {
      if (raw.startsWith("```")) { inCode = !inCode; continue; }
      if (inCode) { out.push({ kind: "code", text: raw }); continue; }
      if (raw.trim() === "") { out.push({ kind: "blank", text: "" }); continue; }
      if (/^#{1,6}\s/.test(raw)) out.push({ kind: "h", text: raw.replace(/^#{1,6}\s*/, "").trim() });
      else if (/^\s*[-*]\s+/.test(raw)) out.push({ kind: "li", text: raw.replace(/^(\s*)[-*]\s+/, "$1· ") });
      else if (/^>\s?/.test(raw)) out.push({ kind: "quote", text: raw.replace(/^>\s?/, "") });
      else out.push({ kind: "text", text: raw });
    }
  }
  return out;
};
