/**
 * One unit of rendered reporter output, tagged by where it goes.
 *
 * `stdout` writes to the process stdout stream, `github-summary`
 * appends to the GitHub Actions step-summary file, and `file` is
 * reserved for reporters that embed their own destination path.
 *
 * `report` writes `filename` into `.vitest/<scope>/` through Vitest 5's
 * `createReport`. The plugin drops these when reporting is disabled,
 * exactly as it drops `github-summary` outside GitHub Actions.
 *
 * @public
 */
export type RenderedOutput =
	| { readonly target: "stdout" | "file" | "github-summary"; readonly content: string; readonly contentType: string }
	| {
			readonly target: "report";
			readonly filename: string;
			readonly content: string;
			readonly contentType: string;
	  };
