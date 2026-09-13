import { Layer } from "effect";
import { DetailResolverLive } from "./DetailResolverLive.js";
import { EnvironmentDetectorLive } from "./EnvironmentDetectorLive.js";
import { ExecutorResolverLive } from "./ExecutorResolverLive.js";
import { FormatSelectorLive } from "./FormatSelectorLive.js";
import { OutputRendererLive } from "./OutputRendererLive.js";
/** @public */
export const OutputPipelineLive = Layer.mergeAll(
	EnvironmentDetectorLive,
	ExecutorResolverLive,
	FormatSelectorLive,
	DetailResolverLive,
	OutputRendererLive,
);
