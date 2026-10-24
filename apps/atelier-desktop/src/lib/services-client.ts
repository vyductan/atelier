import { invoke } from "@tauri-apps/api/core";

import type { ServicesOrder } from "../features/services/services-order";

// Mirrors src-tauri/src/features/services. `ServiceDef` keeps the snake_case
// keys of ~/.atelier/services.yaml; runtime facts are camelCase.

export type ServiceKind = "process" | "launchd" | "remote";

export interface ServiceDef {
  id: string;
  kind: ServiceKind;
  name: string | null;
  group: string | null;
  cwd: string | null;
  cmd: string | null;
  stop_cmd: string | null;
  port: number | null;
  health: string | null;
  url: string | null;
  label: string | null;
  log: string | null;
  icon: string | null;
  env: Record<string, string>;
  keep_alive: boolean;
}

export interface Listener {
  pid: number;
  command: string;
  address: string;
  port: number;
  cwd: string | null;
}

export interface LaunchdState {
  label: string;
  loaded: boolean;
  pid: number | null;
  lastExitCode: number | null;
}

export interface HealthResult {
  url: string;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
}

export interface ServiceStatus {
  def: ServiceDef;
  launchd: LaunchdState | null;
  listener: Listener | null;
  health: HealthResult | null;
  logPath: string | null;
  /** Cached favicon as a data URL, kept while the service is down. */
  favicon: string | null;
}

export interface ServicesSnapshot {
  configPath: string;
  configError: string | null;
  services: ServiceStatus[];
  unregistered: Listener[];
}

export const servicesClient = {
  list: () => invoke<ServicesSnapshot>("list_services"),
  start: (id: string) => invoke<void>("start_service", { id }),
  stop: (id: string) => invoke<void>("stop_service", { id }),
  restart: (id: string) => invoke<void>("restart_service", { id }),
  readLog: (id: string, lines?: number) =>
    invoke<string>("read_service_log", { id, lines }),
  openConfig: () => invoke<void>("open_services_config"),
  getOrder: () => invoke<ServicesOrder>("get_services_order"),
  saveOrder: (order: ServicesOrder) =>
    invoke<void>("save_services_order", { order }),
};
