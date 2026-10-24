import type { ServiceStatus } from "../../lib/services-client";

/**
 * - up:        answers in time
 * - degraded:  something answers, but not well (5xx, slow, port open but silent)
 * - starting:  launchd job alive but nothing listens yet
 * - crashed:   launchd job loaded but its process exited with an error
 * - down:      not running
 * - unmanaged: answers, but Atelier's launchd job is not what runs it, so
 *              Stop/Restart cannot reach it (e.g. a dev server left by a closed terminal)
 */
export type ServiceHealth =
  | "up"
  | "degraded"
  | "starting"
  | "crashed"
  | "down"
  | "unmanaged";

/** Probe latency above which a service that answers counts as degraded. */
export const SLOW_PROBE_MS = { local: 2000, remote: 3000 } as const;

/**
 * Collapses the raw facts the backend gathers into one status per service.
 *
 * Order matters: an answering probe wins over launchd's view of the process,
 * because one-shot commands like `supabase start` exit 0 while the service
 * they started keeps running.
 */
export function deriveServiceHealth(status: ServiceStatus): ServiceHealth {
  const { def, launchd, listener, health } = status;
  const code = health?.statusCode ?? null;
  // Any response below 500 means the server is there: 404 at `/`, 401 without
  // an API key and 3xx redirects are all healthy servers.
  const answers = code !== null && code < 500;
  const slowAfter =
    def.kind === "remote" ? SLOW_PROBE_MS.remote : SLOW_PROBE_MS.local;
  const slow = (health?.latencyMs ?? 0) > slowAfter;

  if (def.kind === "remote") {
    if (code === null) return "down";
    return answers && !slow ? "up" : "degraded";
  }

  if (code !== null && code >= 500) return "degraded";
  if (answers) {
    if (def.kind === "process" && !launchd?.loaded) return "unmanaged";
    return slow ? "degraded" : "up";
  }
  // Port open but the probe timed out or was refused: a hung server.
  if (listener) return "degraded";
  if (launchd?.pid) return "starting";
  if (launchd?.loaded && launchd.lastExitCode) return "crashed";
  return "down";
}
