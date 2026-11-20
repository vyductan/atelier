import type { ServiceHealth } from "./service-health";

export type ServiceAction = "start" | "stop" | "restart";

/** A start/stop/restart the user asked for and the UI is waiting on. */
export interface Transition {
  action: ServiceAction;
  /** Date.now() when the action was sent. */
  since: number;
  /** Pid serving the port when the action was sent, to see a restart happen. */
  pid: number | null;
}

/** Give up waiting after this long and show the real state again. */
export const TRANSITION_TIMEOUT_MS = 20_000;
/** A restart of a pid-less (one-shot) service counts as done after this long up. */
const PIDLESS_RESTART_MS = 3_000;

const RUNNING: ReadonlySet<ServiceHealth> = new Set([
  "up",
  "degraded",
  "unmanaged",
]);
const STOPPED: ReadonlySet<ServiceHealth> = new Set(["down", "crashed"]);

/**
 * Whether the latest snapshot shows the action finished.
 * - stop: the service is down (or crashed on the way).
 * - start: the service answers.
 * - restart: it answers from a different pid than before; services without
 *   a pid (one-shot `supabase start`) only need to be up after a short delay.
 */
export function transitionStatus(
  transition: Transition,
  health: ServiceHealth,
  pid: number | null,
  now: number,
): "pending" | "done" | "timeout" {
  const elapsed = now - transition.since;
  const done =
    transition.action === "stop"
      ? STOPPED.has(health)
      : transition.action === "start"
        ? RUNNING.has(health)
        : RUNNING.has(health) &&
          (transition.pid === null || pid === null
            ? elapsed >= PIDLESS_RESTART_MS
            : pid !== transition.pid);

  if (done) return "done";
  return elapsed >= TRANSITION_TIMEOUT_MS ? "timeout" : "pending";
}

export const TRANSITION_LABEL: Record<ServiceAction, string> = {
  start: "Starting…",
  stop: "Stopping…",
  restart: "Restarting…",
};
