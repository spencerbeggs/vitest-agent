/**
 * The file-link writer an Ink tree draws paths through.
 *
 * The kit decides whether a path becomes an OSC 8 hyperlink and where it
 * opens (`@effected/cli`'s `CliLinks.linker`: `vscode://file/…` under VS
 * Code, `file://` otherwise, never for an agent, nothing on a terminal that
 * cannot render one); the reporter resolves that writer once from its
 * environment and provides it here, so every component that prints a test
 * file or a coverage file draws the same link. Without a provider a path is
 * its label alone, which is what an agent reads. Ink keeps the escape
 * sequence it is handed, so a linked label is drawn as the terminal's link.
 */

import type { CellOptions, FileLinkTarget } from "@vitest-agent/sdk";
import type { FC, ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * The link writer: a file target and its label in, the label (linked when
 * the reader can follow it) out. The same shape as `CellOptions.link`.
 *
 * @public
 */
export type FileLink = NonNullable<CellOptions["link"]>;

const plain: FileLink = (_target: FileLinkTarget, label: string) => label;

const FileLinkContext = createContext<FileLink>(plain);

/**
 * Props for {@link FileLinkProvider}.
 *
 * @public
 */
export interface FileLinkProviderProps {
	/** The writer; omitted, paths are their labels alone. */
	readonly link?: FileLink | undefined;
	/** The tree. */
	readonly children?: ReactNode;
}

/**
 * Provide the file-link writer to an Ink tree.
 *
 * @public
 */
export const FileLinkProvider: FC<FileLinkProviderProps> = ({ link, children }) => (
	<FileLinkContext.Provider value={link ?? plain}>{children}</FileLinkContext.Provider>
);

/**
 * The file-link writer of the tree: the nearest {@link FileLinkProvider}'s,
 * or the label alone.
 *
 * @public
 */
export const useFileLink = (): FileLink => useContext(FileLinkContext);
