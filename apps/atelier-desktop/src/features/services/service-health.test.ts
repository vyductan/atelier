import { describe, expect, it } from "vitest";

import type {
  HealthResult,
  LaunchdState,
  Listener,
  ServiceDef,
  ServiceKind,
  ServiceStatus,
} from "../../lib/services-client";
import { deriveServiceHealth, SLOW_PROBE_MS } from "./service-health";

function makeStatus({
  kind = "process",
  launchd = null,
  listener = null,
  health = null,
}: {
  kind?: ServiceKind;
  launchd?: Partial<LaunchdState> | null;
  listener?: Partial<Listener> | null;
  health?: Partial<HealthResult> | null;
}): ServiceStatus {
  const def: ServiceDef = {
    id: "svc",
    kind,
    name: null,
    group: null,
    cwd: null,
    cmd: kind === "process" ? "pnpm dev" : null,
    stop_cmd: null,
    port: kind === "remote" ? null : 3000,
    health: null,
    url: null,
    label: kind === "launchd" ? "dev.example.agent" : null,
    log: null,
    icon: null,
    env: {},
    keep_alive: false,
  };

  return {
    def,
    launchd:
      launchd === null
        ? null
        : {
            label: "dev.atelier.svc.svc",
            loaded: true,
            pid: null,
            lastExitCode: null,
            ...launchd,
          },
    listener:
      listener === null
        ? null
        : {
            pid: 42,
            command: "node",
            address: "*",
            port: 3000,
            cwd: null,
            ...listener,
          },
    health:
      health === null
        ? null
        : {
            url: "http://localhost:3000/",
            statusCode: 200,
            latencyMs: 10,
            error: null,
            ...health,
          },
    logPath: null,
  };
}

const refused = { statusCode: null, error: "connection refused" };
const managed = { loaded: true, pid: 100 };

describe("deriveServiceHealth", () => {
  describe("remote services", () => {
    it("is up when the probe answers in time", () => {
      expect(
        deriveServiceHealth(
          makeStatus({ kind: "remote", health: { statusCode: 307 } }),
        ),
      ).toBe("up");
    });

    it("is degraded when the probe answers slowly", () => {
      expect(
        deriveServiceHealth(
          makeStatus({
            kind: "remote",
            health: { latencyMs: SLOW_PROBE_MS.remote + 1 },
          }),
        ),
      ).toBe("degraded");
    });

    it("tolerates latency that would be slow for a local service", () => {
      expect(
        deriveServiceHealth(
          makeStatus({
            kind: "remote",
            health: { latencyMs: SLOW_PROBE_MS.local + 1 },
          }),
        ),
      ).toBe("up");
    });

    it("is degraded on a 5xx", () => {
      expect(
        deriveServiceHealth(
          makeStatus({ kind: "remote", health: { statusCode: 502 } }),
        ),
      ).toBe("degraded");
    });

    it("is down when the probe gets no response", () => {
      expect(
        deriveServiceHealth(makeStatus({ kind: "remote", health: refused })),
      ).toBe("down");
    });
  });

  describe("local services", () => {
    it("is degraded on a 5xx even with a healthy launchd job", () => {
      expect(
        deriveServiceHealth(
          makeStatus({
            launchd: managed,
            listener: {},
            health: { statusCode: 500 },
          }),
        ),
      ).toBe("degraded");
    });

    it("is unmanaged when a process service answers without Atelier's job loaded", () => {
      expect(
        deriveServiceHealth(
          makeStatus({
            launchd: { loaded: false },
            listener: {},
            health: {},
          }),
        ),
      ).toBe("unmanaged");
    });

    it("never calls an existing launchd agent unmanaged", () => {
      expect(
        deriveServiceHealth(
          makeStatus({
            kind: "launchd",
            launchd: { loaded: false },
            listener: {},
            health: {},
          }),
        ),
      ).toBe("up");
    });

    it.each([200, 307, 401, 404])("is up when the probe answers %i", (code) => {
      expect(
        deriveServiceHealth(
          makeStatus({
            launchd: managed,
            listener: {},
            health: { statusCode: code },
          }),
        ),
      ).toBe("up");
    });

    it("is up after a one-shot command exited 0 but its service answers", () => {
      // `supabase start`: the job exits once the containers are up.
      expect(
        deriveServiceHealth(
          makeStatus({
            launchd: { loaded: true, pid: null, lastExitCode: 0 },
            listener: {},
            health: { statusCode: 401 },
          }),
        ),
      ).toBe("up");
    });

    it("is degraded when it answers slowly", () => {
      expect(
        deriveServiceHealth(
          makeStatus({
            launchd: managed,
            listener: {},
            health: { latencyMs: SLOW_PROBE_MS.local + 1 },
          }),
        ),
      ).toBe("degraded");
    });

    it("is degraded when the port is open but the probe fails", () => {
      expect(
        deriveServiceHealth(
          makeStatus({
            launchd: managed,
            listener: {},
            health: { statusCode: null, error: "timeout", latencyMs: 3000 },
          }),
        ),
      ).toBe("degraded");
    });

    it("is starting when the job runs but nothing listens yet", () => {
      expect(
        deriveServiceHealth(makeStatus({ launchd: managed, health: refused })),
      ).toBe("starting");
    });

    it("is crashed when the job exited with an error", () => {
      expect(
        deriveServiceHealth(
          makeStatus({
            launchd: { loaded: true, pid: null, lastExitCode: 1 },
            health: refused,
          }),
        ),
      ).toBe("crashed");
    });

    it("is down when the job exited cleanly and nothing answers", () => {
      expect(
        deriveServiceHealth(
          makeStatus({
            launchd: { loaded: true, pid: null, lastExitCode: 0 },
            health: refused,
          }),
        ),
      ).toBe("down");
    });

    it("is down when the job is not loaded and nothing answers", () => {
      expect(
        deriveServiceHealth(
          makeStatus({ launchd: { loaded: false }, health: refused }),
        ),
      ).toBe("down");
    });
  });
});
