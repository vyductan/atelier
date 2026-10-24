import type { DragEndEvent, Modifier } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
import {
  ExternalLink,
  GripVertical,
  Play,
  RefreshCw,
  RotateCw,
  Settings2,
  Square,
} from "lucide-react";

import { Button } from "@acme/ui/components/button";

import type { Listener, ServiceStatus } from "../../lib/services-client";
import type { ServiceHealth } from "./service-health";
import type { ServiceAction, Transition } from "./service-transition";
import type { OrderedGroup, ServicesOrder } from "./services-order";
import { servicesClient } from "../../lib/services-client";
import { useToastStore } from "../../store/toast-store";
import { deriveServiceHealth } from "./service-health";
import { resolveServiceIcon, SERVICE_ICONS } from "./service-icon";
import { TRANSITION_LABEL, transitionStatus } from "./service-transition";
import { applyOrder, moveGroup, moveService, toOrder } from "./services-order";

const SERVICES_QUERY_KEY = ["services"] as const;
const ORDER_QUERY_KEY = ["services-order"] as const;

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

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

function describeProbe(service: ServiceStatus): string | null {
  const { health } = service;
  if (!health) return null;
  if (health.statusCode !== null) {
    return `HTTP ${health.statusCode} · ${health.latencyMs}ms`;
  }
  return health.error;
}

function ServiceIcon({ name }: { name: keyof typeof SERVICE_ICONS }) {
  const Icon = SERVICE_ICONS[name];
  return (
    <Icon
      className="text-muted-foreground size-4 shrink-0"
      aria-hidden="true"
    />
  );
}

/** Sortable wrapper: the item moves as a whole, but only `handle` starts a drag. */
// Separate hover scopes: a group wrapper contains service wrappers, and a
// shared name would reveal every row's handle when hovering the group.
const HOVER_SCOPE = {
  group: { root: "group/grp", handle: "group-hover/grp:opacity-100" },
  service: { root: "group/svc", handle: "group-hover/svc:opacity-100" },
} as const;

function Sortable({
  id,
  label,
  scope,
  children,
}: {
  id: string;
  label: string;
  scope: keyof typeof HOVER_SCOPE;
  children: (handle: ReactNode) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Drag to reorder ${label}`}
      onClick={(event) => event.stopPropagation()}
      className={`text-muted-foreground/60 hover:text-foreground -ml-1 flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded opacity-0 transition ${HOVER_SCOPE[scope].handle} focus-visible:opacity-100 active:cursor-grabbing`}
    >
      <GripVertical className="size-3.5" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      className={`${HOVER_SCOPE[scope].root} ${isDragging ? "relative z-10 opacity-80" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children(handle)}
    </div>
  );
}

function useSortSensors() {
  return useSensors(
    // A few pixels of travel before a drag starts, so clicks stay clicks.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
}

function ServiceRow({
  service,
  selected,
  onSelect,
  handle,
  transition,
  onTransition,
}: {
  service: ServiceStatus;
  selected: boolean;
  onSelect: () => void;
  handle: ReactNode;
  /** Set while a start/stop/restart is on its way, until the snapshot catches up. */
  transition: Transition | undefined;
  onTransition: (transition: Transition | null) => void;
}) {
  const queryClient = useQueryClient();
  const addToast = useToastStore((state) => state.addToast);
  const health = deriveServiceHealth(service);
  const style = HEALTH_STYLE[health];
  const { def } = service;
  const iconSource = resolveServiceIcon(def, service.favicon);
  // Favicons keep their colors only while the service runs, so a gray row
  // reads as "stopped" at a glance and the logo never outshouts the dot.
  const isStopped = health === "down" || health === "crashed";
  const pid = service.listener?.pid ?? service.launchd?.pid ?? null;
  const canControl = def.kind !== "remote";
  const isRunning = health !== "down" && health !== "crashed";
  // Remote services have no log file, so their row is not a button.
  const hasLog = service.logPath !== null;

  const action = useMutation({
    mutationFn: async (kind: ServiceAction) => {
      await servicesClient[kind](def.id);
    },
    onError: (error, kind) => {
      onTransition(null);
      addToast(`${kind} ${def.id} failed: ${String(error)}`, "error");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
  });

  const run = async (kind: ServiceAction) => {
    // Stopping something Atelier did not start signals a process the user
    // launched elsewhere (often a terminal), so ask first.
    if (health === "unmanaged" && kind !== "start") {
      const confirmed = await ask(
        `${def.name ?? def.id} is running outside Atelier (pid ${pid ?? "?"}). ` +
          (kind === "stop"
            ? "Stop that process?"
            : "Stop it and restart it under Atelier?"),
        {
          title: kind === "stop" ? "Stop process" : "Restart under Atelier",
          kind: "warning",
        },
      );
      if (!confirmed) return;
    }
    onTransition({ action: kind, since: Date.now(), pid });
    action.mutate(kind);
  };
  const busy = transition !== undefined;
  const dot = transition
    ? transition.action === "stop"
      ? "bg-amber-500 animate-pulse"
      : "bg-sky-500 animate-pulse"
    : style.dot;
  const label = transition ? TRANSITION_LABEL[transition.action] : style.label;

  return (
    <div
      {...(hasLog
        ? {
            role: "button",
            tabIndex: 0,
            "aria-expanded": selected,
            "aria-label": `${selected ? "Hide" : "Show"} logs for ${def.name ?? def.id}`,
            onClick: onSelect,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
              // Only the row itself: Enter on a nested button runs that button.
              if (
                event.key === "Enter" &&
                event.target === event.currentTarget
              ) {
                event.preventDefault();
                onSelect();
              }
            },
          }
        : {})}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${selected ? "border-primary/50 bg-primary/5" : "bg-card"} ${hasLog ? "hover:bg-muted/40 focus-visible:ring-ring cursor-pointer outline-none focus-visible:ring-2" : ""}`}
    >
      {handle}
      <span
        className={`size-2.5 shrink-0 rounded-full transition-colors ${dot}`}
        title={label}
      />
      {iconSource.type === "image" ? (
        <img
          src={iconSource.src}
          alt=""
          className={`size-4 shrink-0 rounded-sm object-contain transition ${isStopped ? "opacity-50 grayscale" : ""}`}
        />
      ) : (
        <ServiceIcon name={iconSource.name} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">
            {def.name ?? def.id}
          </span>
          <span className="text-muted-foreground text-xs">{def.kind}</span>
        </div>
        <div className="text-muted-foreground flex gap-3 truncate text-xs">
          <span className={busy ? "text-foreground" : undefined}>{label}</span>
          {def.port === null ? null : <span>:{def.port}</span>}
          {pid === null ? null : <span>pid {pid}</span>}
          {service.launchd?.lastExitCode ? (
            <span>exit {service.launchd.lastExitCode}</span>
          ) : null}
          {describeProbe(service) ? (
            <span>{describeProbe(service)}</span>
          ) : null}
        </div>
      </div>

      {/* Actions keep their own behavior instead of also toggling the logs. */}
      <div
        className="flex shrink-0 items-center gap-1"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {def.url ? (
          <Button
            type="text"
            size="small"
            icon={<ExternalLink className="size-3.5" />}
            aria-label="Open"
            onClick={() => void open(def.url!)}
          />
        ) : null}
        {canControl ? (
          isRunning ? (
            <>
              <Button
                type="text"
                size="small"
                loading={transition?.action === "restart"}
                disabled={busy}
                icon={<RotateCw className="size-3.5" />}
                aria-label="Restart"
                onClick={() => void run("restart")}
              />
              <Button
                type="text"
                size="small"
                loading={transition?.action === "stop"}
                disabled={busy}
                icon={<Square className="size-3.5" />}
                aria-label="Stop"
                onClick={() => void run("stop")}
              />
            </>
          ) : (
            <Button
              type="text"
              size="small"
              loading={transition?.action === "start"}
              disabled={busy}
              icon={<Play className="size-3.5" />}
              aria-label="Start"
              onClick={() => void run("start")}
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
        className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap"
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
  const [transitions, setTransitions] = useState<Record<string, Transition>>(
    {},
  );
  const hasTransitions = Object.keys(transitions).length > 0;
  const snapshot = useQuery({
    queryKey: SERVICES_QUERY_KEY,
    queryFn: servicesClient.list,
    // Poll fast while an action is in flight so the row settles promptly.
    refetchInterval: hasTransitions ? 1000 : 5000,
  });
  const queryClient = useQueryClient();
  const addToast = useToastStore((state) => state.addToast);
  const order = useQuery({
    queryKey: ORDER_QUERY_KEY,
    queryFn: servicesClient.getOrder,
    staleTime: Infinity,
  });
  const saveOrder = useMutation({
    mutationFn: servicesClient.saveOrder,
    // Show the new order at once; the file write catches up behind it.
    onMutate: (next: ServicesOrder) => {
      queryClient.setQueryData(ORDER_QUERY_KEY, next);
    },
    onError: (error) => {
      addToast(`Could not save the order: ${String(error)}`, "error");
      void queryClient.invalidateQueries({ queryKey: ORDER_QUERY_KEY });
    },
  });
  const groups = useMemo(
    () => applyOrder(snapshot.data?.services ?? [], order.data),
    [snapshot.data, order.data],
  );
  const sensors = useSortSensors();

  // Retire transitions the latest snapshot has caught up with.
  useEffect(() => {
    if (!snapshot.data || !hasTransitions) return;
    const now = Date.now();
    const next: Record<string, Transition> = {};
    for (const [id, transition] of Object.entries(transitions)) {
      const service = snapshot.data.services.find((s) => s.def.id === id);
      if (!service) continue;
      const pid = service.listener?.pid ?? service.launchd?.pid ?? null;
      const status = transitionStatus(
        transition,
        deriveServiceHealth(service),
        pid,
        now,
      );
      if (status === "pending") next[id] = transition;
      if (status === "timeout") {
        addToast(
          `${service.def.name ?? id}: still ${transition.action === "stop" ? "running" : "not up"} after 20s`,
          "error",
        );
      }
    }
    if (Object.keys(next).length !== Object.keys(transitions).length) {
      setTransitions(next);
    }
  }, [snapshot.data, transitions, hasTransitions, addToast]);

  const setTransition = (id: string, transition: Transition | null) => {
    setTransitions((current) => {
      const { [id]: _previous, ...rest } = current;
      return transition ? { ...rest, [id]: transition } : rest;
    });
  };

  const persist = (next: OrderedGroup<ServiceStatus>[]) => {
    saveOrder.mutate(toOrder(next));
  };
  const handleGroupDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      persist(moveGroup(groups, String(active.id), String(over.id)));
    }
  };
  const handleServiceDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      persist(moveService(groups, String(active.id), String(over.id)));
    }
  };

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

        {/* Groups and each group's services are separate drag contexts, so a
            service can only be dropped within its own group. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleGroupDragEnd}
        >
          <SortableContext
            items={groups.map((group) => group.name)}
            strategy={verticalListSortingStrategy}
          >
            {groups.map((group) => (
              <Sortable
                key={group.name}
                scope="group"
                id={group.name}
                label={`group ${group.name}`}
              >
                {(groupHandle) => (
                  <div className="mb-5">
                    <h3 className="text-muted-foreground mb-2 flex items-center gap-1 text-xs font-medium tracking-wide uppercase">
                      {groupHandle}
                      {group.name}
                    </h3>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      modifiers={[restrictToVerticalAxis]}
                      onDragEnd={handleServiceDragEnd}
                    >
                      <SortableContext
                        items={group.services.map((service) => service.def.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="flex flex-col gap-2">
                          {group.services.map((service) => (
                            <Sortable
                              key={service.def.id}
                              scope="service"
                              id={service.def.id}
                              label={service.def.name ?? service.def.id}
                            >
                              {(handle) => (
                                <ServiceRow
                                  service={service}
                                  handle={handle}
                                  transition={transitions[service.def.id]}
                                  onTransition={(transition) =>
                                    setTransition(service.def.id, transition)
                                  }
                                  selected={service.def.id === selectedId}
                                  onSelect={() =>
                                    setSelectedId((current) =>
                                      current === service.def.id
                                        ? null
                                        : service.def.id,
                                    )
                                  }
                                />
                              )}
                            </Sortable>
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>
                )}
              </Sortable>
            ))}
          </SortableContext>
        </DndContext>

        <UnregisteredListeners listeners={snapshot.data?.unregistered ?? []} />
      </section>

      {selectedId ? <LogPane key={selectedId} serviceId={selectedId} /> : null}
    </div>
  );
}
