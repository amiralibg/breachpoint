/**
 * Developer mode is the local dev server only (`npm run dev`): main.ts loads the panel behind
 * `import.meta.env.DEV`, a build-time constant, so production builds (`npm run build`, Docker)
 * contain no developer code and no URL flag can turn it on.
 */

/** All chapters open (set by the developer panel). */
export const devState = { unlockAll: false };
