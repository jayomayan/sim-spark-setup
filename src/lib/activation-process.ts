/** Open runs stay retryable this long without activity, then are closed and paused. */
export const RETRY_WINDOW_MS = 3 * 60_000;
/** While a step is working, the page refreshes activity well inside the retry window. */
export const ACTIVITY_HEARTBEAT_MS = 30_000;
export const OPEN_STATUSES = ["running", "waiting_ip", "needs_retry"] as const;

/** Only Router SIMs this app actually turned on are paused when the run is left unfinished. */
export function needsPause(row: { equipment: string[]; sim_activated: boolean; simulated: boolean }) {
  return row.equipment.includes("ur35") && row.sim_activated && !row.simulated;
}

export function isStale(row: { status: string; last_activity_at: string; finished_at: string | null }, now = Date.now()) {
  return row.finished_at === null && (OPEN_STATUSES as readonly string[]).includes(row.status)
    && now - new Date(row.last_activity_at).getTime() >= RETRY_WINDOW_MS;
}
