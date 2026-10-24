import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-shell";
import {
  ExternalLink,
  FileText,
  Play,
  RefreshCw,
  RotateCw,
  Settings2,
  Square,
} from "lucide-react";

import { Button } from "@acme/ui/components/button";

import type { Listener, ServiceStatus } from "../../lib/services-client";
import type { ServiceHealth } from "./service-health";
import { servicesClient } from "../../lib/services-client";
import { useToastStore } from "../../store/toast-store";
import { deriveServiceHealth } from "./service-health";
import { inferServiceIcon, SERVICE_ICONS } from "./service-icon";

const SERVICES_QUERY_KEY = ["services"] as const;

/** How close to the bottom (px) still counts as "following" the log. */
const FOLLOW_THRESHOLD = 24;

const HEALTH_STYLE: Record<ServiceHealth, { dot: string; label: string }> = {
  up: { dot: "bg-emerald-500", label: "Up" },
  degraded: { dot: "bg-amber-500", label: "Degraded" },
  starting: { dot: "bg-sky-500 animate-pulse", label: "Starting" },
  crashed: { dot: "bg-red-500", label: "Crashed" },
  down: { dot: "bg-muted-foreground/40", label: "Down" },
  unmanaged: { dot: "bg-violet-500", label: "Running outside Atelier" },
};

function groupServices(services: ServiceStatus[]): [string, ServiceStatus[]][] {
  const groups = new Map<string, ServiceStatus[]>();
  for (const service of services) {
    const group = service.def.group ?? "Other";
    groups.set(group, [...(groups.get(group) ?? []), service]);
  }
  return [...groups.entries()];
}

function describeProbe(service: ServiceStatus): string | null {
  const { health } = service;
  if (!health) return null;
  if (health.statusCode !== null) {
    return `HTTP ${health.statusCode} · ${health.latencyMs}ms`;
  }
  return health.error;
}

function ServiceRow({
  service,
  selected,
  onSelect,
}: {
  service: ServiceStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  const queryClient = useQueryClient();
  const addToast = useToastStore((state) => state.addToast);
  const health = deriveServiceHealth(service);
  const style = HEALTH_STYLE[health];
  const { def } = service;
  const Icon = SERVICE_ICONS[inferServiceIcon(def)];
  const pid = service.listener?.pid ?? service.launchd?.pid ?? null;
  const canControl = def.kind !== "remote";
  const isRunning = health !== "down" && health !== "crashed";

  const action = useMutation({
    mutationFn: async (kind: "start" | "stop" | "restart") => {
      await servicesClient[kind](def.id);
    },
    onError: (error, kind) => {
      addToast(`${kind} ${def.id} failed: ${String(error)}`, "error");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
  });

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${selected ? "border-primary/50 bg-primary/5" : "bg-card"}`}
    >
      <span
        className={`size-2.5 shrink-0 rounded-full ${style.dot}`}
        title={style.label}
      />
      <Icon
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">
            {def.name ?? def.id}
          </span>
          <span className="text-muted-foreground text-xs">{def.kind}</span>
        </div>
        <div className="text-muted-foreground flex gap-3 truncate text-xs">
          <span>{style.label}</span>
          {def.port === null ? null : <span>:{def.port}</span>}
          {pid === null ? null : <span>pid {pid}</span>}
          {service.launchd?.lastExitCode ? (
            <span>exit {service.launchd.lastExitCode}</span>
          ) : null}
          {describeProbe(service) ? <span>{describeProbe(service)}</span> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {def.url ? (
          <Button
            type="text"
            size="small"
            icon={<ExternalLink className="size-3.5" />}
            aria-label="Open"
            onClick={() => void open(def.url!)}
          />
        ) : null}
        {service.logPath ? (
          <Button
            type="text"
            size="small"
            icon={<FileText className="size-3.5" />}
            aria-label="Logs"
            onClick={onSelect}
          />
        ) : null}
        {canControl ? (
          isRunning ? (
            <>
              <Button
                type="text"
                size="small"
                loading={action.isPending && action.variables === "restart"}
                icon={<RotateCw className="size-3.5" />}
                aria-label="Restart"
                onClick={() => action.mutate("restart")}
              />
              <Button
                type="text"
                size="small"
                loading={action.isPending && action.variables === "stop"}
                icon={<Square className="size-3.5" />}
                aria-label="Stop"
                onClick={() => action.mutate("stop")}
              />
            </>
          ) : (
            <Button
              type="text"
              size="small"
              loading={action.isPending && action.variables === "start"}
              icon={<Play className="size-3.5" />}
              aria-label="Start"
              onClick={() => action.mutate("start")}
            />
          )
        ) : null}
      </div>
    </div>
  );
}

function LogPane({ serviceId }: { serviceId: string }) {
  const log = useQuery({
    queryKey: ["service-log", serviceId],
    queryFn: () => servicesClient.readLog(serviceId, 300),
    refetchInterval: 2000,
  });
  const scrollRef = useRef<HTMLPreElement>(null);
  // Follow the tail like `tail -f` until the user scrolls up to read; resume
  // once they scroll back to the bottom.
  const followRef = useRef(true);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [log.data, log.error]);

  return (
    <section className="flex min-h-0 w-1/2 shrink-0 flex-col border-l">
      <header className="text-muted-foreground border-b px-4 py-2 text-xs">
        Logs · {serviceId}
      </header>
      <pre
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            FOLLOW_THRESHOLD;
        }}
        className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {log.error
          ? String(log.error)
          : log.data?.trim()
            ? log.data
            : "No output yet."}
      </pre>
    </section>
  );
}

function UnregisteredListeners({ listeners }: { listeners: Listener[] }) {
  if (listeners.length === 0) return null;
  return (
    <details className="mt-6">
      <summary className="text-muted-foreground cursor-pointer text-xs font-medium tracking-wide uppercase">
        Other listening ports ({listeners.length})
      </summary>
      <div className="mt-2 flex flex-col gap-1">
        {listeners.map((listener) => (
          <div
            key={`${listener.pid}:${listener.port}`}
            className="text-muted-foreground flex gap-3 font-mono text-xs whitespace-nowrap"
          >
            <span className="w-14 text-right">:{listener.port}</span>
            <span className="w-28 truncate">{listener.command}</span>
            <span className="w-20">pid {listener.pid}</span>
            <span className="truncate">{listener.cwd}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

export function ServicesPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const snapshot = useQuery({
    queryKey: SERVICES_QUERY_KEY,
    queryFn: servicesClient.list,
    refetchInterval: 5000,
  });
  const groups = useMemo(
    () => groupServices(snapshot.data?.services ?? []),
    [snapshot.data],
  );

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-6 py-5">
        <header className="mb-4 flex items-center gap-2">
          <h2 className="text-sm font-semibold">Services</h2>
          <span className="text-muted-foreground truncate text-xs">
            {snapshot.data?.configPath}
          </span>
          <div className="ml-auto flex gap-1">
            <Button
              type="text"
              size="small"
              loading={snapshot.isFetching}
              icon={<RefreshCw className="size-3.5" />}
              aria-label="Refresh"
              onClick={() => void snapshot.refetch()}
            />
            <Button
              type="default"
              size="small"
              icon={<Settings2 className="size-3.5" />}
              onClick={() => void servicesClient.openConfig()}
            >
              Edit services.yaml
            </Button>
          </div>
        </header>

        {snapshot.error ? (
          <p className="text-destructive text-sm">{String(snapshot.error)}</p>
        ) : null}
        {snapshot.data?.configError ? (
          <p className="text-destructive mb-4 rounded-md border border-current/30 px-3 py-2 font-mono text-xs">
            {snapshot.data.configError}
          </p>
        ) : null}

        {groups.map(([group, services]) => (
          <div key={group} className="mb-5">
            <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
              {group}
            </h3>
            <div className="flex flex-col gap-2">
              {services.map((service) => (
                <ServiceRow
                  key={service.def.id}
                  service={service}
                  selected={service.def.id === selectedId}
                  onSelect={() =>
                    setSelectedId((current) =>
                      current === service.def.id ? null : service.def.id,
                    )
                  }
                />
              ))}
            </div>
          </div>
        ))}

        <UnregisteredListeners listeners={snapshot.data?.unregistered ?? []} />
      </section>

      {selectedId ? <LogPane key={selectedId} serviceId={selectedId} /> : null}
    </div>
  );
}
