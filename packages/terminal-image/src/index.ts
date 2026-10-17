/** Inline image rendering for terminals: capability detection + escape emission.
 *
 * Shared by the CLI (`tk show`) and the TUI. Zero dependencies; the process
 * environment is only consulted through the injectable `io` so callers stay
 * testable. Kitty graphics protocol covers kitty and Ghostty; iTerm2's
 * OSC 1337 covers the rest (iTerm.app, WezTerm, vscode, mintty).
 */

export type TerminalImageKind = "kitty" | "osc1337";

export interface TerminalImageIO {
	env: Readonly<Record<string, string | undefined>>;
	isTTY: boolean;
}

export interface TerminalImageSource {
	bytes: Uint8Array;
	name: string;
	mime: string;
}

/** Detects an inline-image-capable terminal profile, or null. */
export const terminalImageKind = (io: TerminalImageIO): TerminalImageKind | null => {
	if (!io.isTTY) return null;
	if (io.env["KITTY_WINDOW_ID"] !== undefined || io.env["GHOSTTY_RESOURCES_DIR"] !== undefined) return "kitty";
	return ["iTerm.app", "WezTerm", "vscode", "mintty"].includes(io.env["TERM_PROGRAM"] ?? "") ? "osc1337" : null;
};

/** Kitty graphics escape for PNG bytes. Streams as transmit-and-display (`a=T`,
 * format 100 = PNG, `t=d` direct payload, `q=1` no response), chunked at
 * 4096 base64 bytes with `m=1` continuations until the final `m=0`. */
export const kittyImageEscape = (bytes: Uint8Array): string => {
	const base64 = Buffer.from(bytes).toString("base64");
	if (base64.length === 0) return "\x1b_Ga=T,f=100,t=d,q=1,m=0;\x1b\\";
	const chunks: string[] = [];
	for (let index = 0; index < base64.length; index += 4096) {
		const header = index === 0 ? "a=T,f=100,t=d,q=1," : "";
		const more = index + 4096 < base64.length;
		chunks.push(`\x1b_G${header}${more ? "m=1" : "m=0"};${base64.slice(index, index + 4096)}\x1b\\`);
	}
	return chunks.join("");
};

/** OSC 1337 inline-file escape (iTerm2 and derivatives). */
export const osc1337ImageEscape = (image: { bytes: Uint8Array; name: string }): string =>
	`\x1b]1337;File=${Buffer.from(image.name).toString("base64")};inline=1;preserveAspectRatio=1:${Buffer.from(image.bytes).toString("base64")}\x1b\\`;

/** Escape for one image, or null when the terminal cannot render it inline. */
export const terminalImageEscape = (image: TerminalImageSource, io?: TerminalImageIO): string | null => {
	const kind = terminalImageKind(io ?? { env: process.env, isTTY: Boolean(process.stdout.isTTY) });
	if (kind === null || !image.mime.startsWith("image/")) return null;
	// f=100 is PNG data; non-PNG images have no safe kitty encoding here, while OSC 1337 terminals take any image mime.
	if (kind === "kitty" && image.mime !== "image/png") return null;
	return kind === "kitty" ? kittyImageEscape(image.bytes) : osc1337ImageEscape(image);
};
