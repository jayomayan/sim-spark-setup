/**
 * The SIM is activated straight away, but the device can take a moment to come
 * online and be handed an IP address. We wait up to two minutes, then stop and
 * let the user start another two-minute wait instead of failing the activation.
 */
export const IP_WAIT_TIMEOUT_MS = 120_000;

/** How often Console Connect is asked for the assigned IP address. */
export const IP_WAIT_POLL_MS = 5_000;

/** True while the two-minute wait window is still open. */
export function ipWaitOpen(elapsedMs: number): boolean {
  return elapsedMs < IP_WAIT_TIMEOUT_MS;
}

/** Whole seconds left in the current wait window, never negative. */
export function ipWaitSecondsLeft(elapsedMs: number): number {
  return Math.max(0, Math.ceil((IP_WAIT_TIMEOUT_MS - elapsedMs) / 1000));
}
