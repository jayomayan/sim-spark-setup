/** Activation process states recorded in public.sim_activations.status. */
export const ACTIVATION_STATUSES = ["INITIATED", "IN_PROGRESS", "RETRYING", "COMPLETED", "UNFINISHED", "TERMINATED"] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

/** What each state means; shown beside the status in Activation Reports. */
export const ACTIVATION_STATUS_DESCRIPTIONS: Record<ActivationStatus, string> = {
  INITIATED: "Activation process has started.",
  IN_PROGRESS: "Activation is currently being processed.",
  RETRYING: "IP acquisition or firewall configuration is being retried.",
  COMPLETED: "All required activation steps have completed successfully.",
  UNFINISHED: "Process was interrupted or abandoned before completion.",
  TERMINATED: "Process was automatically terminated due to timeout.",
};

/** Open runs stay retryable this long without activity, then are closed and paused. */
export const RETRY_WINDOW_MS = 3 * 60_000;
/** While a step is working, the page refreshes activity well inside the retry window. */
export const ACTIVITY_HEARTBEAT_MS = 30_000;
/** Runs a retry or the cleanup sweep can still pick up. */
export const OPEN_STATUSES: readonly ActivationStatus[] = ["INITIATED", "IN_PROGRESS", "RETRYING"];
/** A run that never completes is closed as abandoned (UNFINISHED) or timed out (TERMINATED). */
export type CloseOutcome = Extract<ActivationStatus, "UNFINISHED" | "TERMINATED">;

/** Only Router SIMs this app actually turned on are paused when the run is left unfinished. */
export function needsPause(row: { equipment: string[]; sim_activated: boolean; simulated: boolean }) {
  return row.equipment.includes("ur35") && row.sim_activated && !row.simulated;
}

export function isStale(row: { status: string; last_activity_at: string; finished_at: string | null }, now = Date.now()) {
  return row.finished_at === null && (OPEN_STATUSES as readonly string[]).includes(row.status)
    && now - new Date(row.last_activity_at).getTime() >= RETRY_WINDOW_MS;
}
