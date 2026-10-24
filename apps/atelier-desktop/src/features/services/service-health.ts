import type { ServiceStatus } from "../../lib/services-client";

/**
 * - up:       doing its job
 * - degraded: something answers, but not well (port open but probe fails, 5xx, slow)
 * - starting: launchd job alive but nothing answers yet
 * - crashed:  launchd job loaded but its process exited with an error
 * - down:     not running
 */
export type ServiceHealth = "up" | "degraded" | "starting" | "crashed" | "down";

/**
 * Collapses the raw facts the backend gathers into one status per service.
 *
 * Facts available on `status`:
 * - `status.def.kind`: "process" | "launchd" | "remote"
 * - `status.launchd`: { loaded, pid, lastExitCode } or null (remote)
 * - `status.listener`: the lsof listener on `def.port`, or null
 * - `status.health`: { statusCode, latencyMs, error } or null when there is
 *   neither `health` nor `port` to probe
 *
 * TODO(you): implement. Questions worth deciding:
 * - Is a 401/404 "up"? (Supabase REST returns 401 without a key and that is fine.)
 * - Should a slow probe (latencyMs > ?) count as degraded?
 * - A `supabase start` job exits 0 once containers are up: launchd says
 *   pid=null, lastExitCode=0, yet the service is healthy. Don't call that down.
 */
export function deriveServiceHealth(status: ServiceStatus): ServiceHealth {
  return status.listener || status.health?.statusCode ? "up" : "down";
}
