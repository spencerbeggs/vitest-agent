/** Build-time injected package version (see architecture.md D36). @public */
export const CURRENT_ENGINE_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
