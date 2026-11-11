// Build-time app version, injected by Vite from scripts/app-version.mjs.
// Falls back to "dev" when running without the define (e.g. unit tests).
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "dev";
