/** @public */
export interface Osc8Options {
	readonly enabled: boolean;
}

const ESC = "\x1b";
const BEL = "\x07";
/** @public */
export const osc8 = (url: string, label: string, options: Osc8Options): string => {
	if (!options.enabled) return label;
	return `${ESC}]8;;${url}${BEL}${label}${ESC}]8;;${BEL}`;
};
