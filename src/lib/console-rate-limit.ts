/** Provider throttling is temporary, not a SIM activation failure. */
export class ConsoleRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("Console Connect is limiting requests (HTTP 429). IP checks will retry after a pause.");
    this.name = "ConsoleRateLimitError";
  }
}

export function checkConsoleRateLimit(response: Response) {
  if (response.status !== 429) return;
  const header = response.headers.get("Retry-After");
  const seconds = header !== null && /^\d+$/.test(header.trim()) ? Number(header) * 1000 : NaN;
  const dateDelay = header ? Date.parse(header) - Date.now() : NaN;
  const delay = Number.isFinite(seconds) ? seconds : Number.isFinite(dateDelay) ? dateDelay : 30_000;
  throw new ConsoleRateLimitError(Math.max(5_000, delay));
}