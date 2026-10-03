import { Layer } from "effect";
import { DetailResolverLive } from "./DetailResolverLive.js";
import { EnvironmentDetectorLive } from "./EnvironmentDetectorLive.js";
import { ExecutorResolverLive } from "./ExecutorResolverLive.js";
import { FormatSelectorLive } from "./FormatSelectorLive.js";

/**
 * The output pipeline: environment detection, executor resolution, format
 * selection and detail resolution.
 *
 * @param env - the environment map `EnvironmentDetectorLive` consults
 *   (the front end passes `process.env`)
 * @public
 */
export const OutputPipelineLive = (env: Record<string, string | undefined>) =>
	Layer.mergeAll(EnvironmentDetectorLive(env), ExecutorResolverLive, FormatSelectorLive, DetailResolverLive);
