// Standard browser persistence for standalone builds; no parent-window broker.
export function brokeredPreviewStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}