/**
 * Colour-bearing snapshots for Ink frames.
 *
 * ink-testing-library renders through Ink's own `chalk` instance, which
 * detects a non-TTY test worker and paints nothing — so a plain frame
 * snapshot pins glyphs and layout but not colour. `forceInkColor` flips
 * that instance to truecolor for the calling test file, and `ansiToTags`
 * turns the SGR sequences into readable `{green}` / `{/fg}` tags so the
 * snapshot file stays reviewable.
 */

const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

const FG: Record<number, string> = {
	30: "black",
	31: "red",
	32: "green",
	33: "yellow",
	34: "blue",
	35: "magenta",
	36: "cyan",
	37: "white",
	90: "gray",
	91: "brightRed",
	92: "brightGreen",
	93: "brightYellow",
	94: "brightBlue",
	95: "brightMagenta",
	96: "brightCyan",
	97: "brightWhite",
};

const ATTR: Record<number, string> = {
	0: "reset",
	1: "bold",
	2: "dim",
	3: "italic",
	4: "underline",
	22: "/bold|dim",
	23: "/italic",
	24: "/underline",
	39: "/fg",
};

const hex = (n: number): string => n.toString(16).padStart(2, "0");

const tagsFor = (params: string): ReadonlyArray<string> => {
	const codes = params === "" ? [0] : params.split(";").map(Number);
	const out: string[] = [];
	for (let i = 0; i < codes.length; i++) {
		const code = codes[i] ?? 0;
		if (code === 38 && codes[i + 1] === 2) {
			out.push(`#${hex(codes[i + 2] ?? 0)}${hex(codes[i + 3] ?? 0)}${hex(codes[i + 4] ?? 0)}`);
			i += 4;
			continue;
		}
		out.push(FG[code] ?? ATTR[code] ?? `sgr${code}`);
	}
	return out;
};

/** Replace every SGR escape with `{tag}` markers. */
export const ansiToTags = (input: string): string =>
	input.replace(SGR, (_m, params: string) =>
		tagsFor(params)
			.map((t) => `{${t}}`)
			.join(""),
	);

interface ChalkLike {
	level: number;
}

/**
 * Set Ink's chalk instance to truecolor (level 3). Resolved relative to the
 * installed `ink` entry so it is the very instance Ink paints with.
 */
export const forceInkColor = async (): Promise<() => void> => {
	const chalkUrl = new URL("../../chalk/source/index.js", import.meta.resolve("ink"));
	const mod = (await import(chalkUrl.href)) as { default: ChalkLike };
	const previous = mod.default.level;
	mod.default.level = 3;
	return () => {
		mod.default.level = previous;
	};
};
