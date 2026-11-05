declare const __KIOKU_VERSION__: string;

/** The tool's version, written into the bundle by the build from `package.json` (§6.4). */
export const VERSION = typeof __KIOKU_VERSION__ === "string" ? __KIOKU_VERSION__ : "0.0.0-dev";

/**
 * The version of the JSON the verbs answer with (§6.1), 1 in 0.1.0, 2 since a brain is named by its name and
 * `brain trust` is gone (§2.2, §2.4). It moves only when a field a program reads is removed or changes meaning; a field
 * added does not move it. A program that mounts the tool checks it before relying on a shape.
 */
export const CLI_CONTRACT = 2;
