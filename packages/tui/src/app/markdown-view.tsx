import { EvidenceImage } from "./evidence-image.js";
import type { MdLine } from "./markdown.js";
import { colors } from "../theme.js";
import { truncate } from "../format.js";

/**
 * One shaped markdown line, rendered exactly as the detail pane renders its
 * description: header, bullet, code (cyan, indented), quote (`▎`), text, a
 * blank row, or an evidence image. `width` (optional) truncates text lines.
 */
export const MdLineView = ({ line, issueId, maxCellWidth, width }: {
  readonly line: MdLine;
  readonly issueId: string;
  readonly maxCellWidth: number;
  readonly width?: number;
}) => {
  const fit = (value: string): string => (width === undefined ? value : truncate(value, Math.max(1, width)));
  if (line.kind === "img") return <EvidenceImage issueId={issueId} refId={line.text} maxCellWidth={maxCellWidth} />;
  if (line.kind === "blank") return <text content=" " />;
  if (line.kind === "h") return <text fg={colors.text}>{fit(line.text)}</text>;
  if (line.kind === "code") return <text fg={colors.cyan} content={fit(`  ${line.text}`)} />;
  if (line.kind === "quote") return <text><span fg={colors.dim}>▎</span><span fg={colors.dim}>{fit(line.text)}</span></text>;
  return <text fg={colors.text} content={fit(line.text)} />;
};
