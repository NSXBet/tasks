/**
 * Hunk-granular copy text for the review's `v` select / `y` copy keys. The
 * view has no line cursor, so a selection is a range of hunk indices within
 * the selected file. Pure: reads only the file's patch text.
 */
import type { HunkDiffFile } from "@tasks/review/opentui";

/** The file's patch split into one string per `@@` hunk (header line included, file headers excluded); `[]` when there are none. */
export const hunkPatchTexts = (file: HunkDiffFile): readonly string[] => {
  const hunks: string[][] = [];
  for (const line of (file.patch ?? "").split("\n")) {
    if (line.startsWith("@@")) hunks.push([line]);
    else if (hunks.length > 0 && !line.startsWith("diff --git ")) hunks[hunks.length - 1]!.push(line);
  }
  return hunks.map((lines) => {
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  });
};

/** Hunks `from..to` (bounds swapped when reversed, clamped) joined by `\n`; with null bounds, the whole file patch. */
export const reviewSelectionText = (file: HunkDiffFile, from: number | null, to: number | null): string => {
  if (from === null || to === null) return file.patch ?? "";
  const hunks = hunkPatchTexts(file);
  const low = Math.max(0, Math.min(from, to));
  const high = Math.min(hunks.length - 1, Math.max(from, to));
  return hunks.slice(low, high + 1).join("\n");
};
