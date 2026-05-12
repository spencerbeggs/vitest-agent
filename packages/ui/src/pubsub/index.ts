/**
 * Effect channel and helpers for transporting {@link RunEvent} values
 * between hosts (Vitest reporter callbacks, CLI replay constructors)
 * and renderers (Ink human-mode tree, agent-mode accumulator).
 *
 * @packageDocumentation
 */

export { RunEventChannel, RunEventChannelLive } from "./Channel.js";
export { publish, publishAll } from "./Publisher.js";
export {
	accumulateUntilFinished,
	forEachRenderState,
	renderStateStream,
	subscribeRaw,
} from "./Subscriber.js";
