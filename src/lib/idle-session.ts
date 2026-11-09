export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000;
export const idleActivityKey = (userId: string) => `field-ops:last-activity:${userId}`;

// Store timestamps only, never session credentials. Storage can be unavailable.
export function saveActivity(userId: string, now = Date.now()) {
  try { localStorage.setItem(idleActivityKey(userId), String(now)); } catch { /* In-memory fallback. */ }
}

export function startIdleSession(userId: string, onWarning: (seconds: number | null) => void, onExpire: () => void) {
  const key = idleActivityKey(userId);
  const read = () => {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) && value > 0 && value <= Date.now() ? value : null;
    } catch { return null; }
  };
  let lastActivity = read() ?? Date.now();
  let lastWrite = lastActivity;
  let expired = false;
  saveActivity(userId, lastActivity);

  const check = () => {
    if (expired) return false;
    lastActivity = Math.max(lastActivity, read() ?? lastActivity);
    const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivity);
    if (remaining <= 0) {
      expired = true;
      onWarning(null);
      onExpire();
      return false;
    }
    onWarning(remaining <= IDLE_WARNING_MS ? Math.ceil(remaining / 1000) : null);
    return true;
  };
  const activity = () => {
    // Sleeping tabs must expire before any new activity can revive them.
    if (!check()) return;
    lastActivity = Date.now();
    if (lastActivity - lastWrite >= 1000) {
      saveActivity(userId, lastActivity);
      lastWrite = lastActivity;
    }
    onWarning(null);
  };
  const resume = () => { check(); };
  const storage = (event: StorageEvent) => { if (event.key === key) check(); };
  const events = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"];
  events.forEach(event => window.addEventListener(event, activity, { passive: true, capture: true }));
  window.addEventListener("storage", storage);
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  const timer = window.setInterval(check, 1000);
  check();
  return {
    staySignedIn: activity,
    stop: () => {
      clearInterval(timer);
      events.forEach(event => window.removeEventListener(event, activity, true));
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    },
  };
}