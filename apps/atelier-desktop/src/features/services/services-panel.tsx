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
  Play,
  RefreshCw,
  RotateCw,
  Settings2,
  Square,
} from "lucide-react";

import { Button } from "@acme/ui/components/button";

import type {
  KnownListener,
  Listener,
  ServiceStatus,
} from "../../lib/services-client";
import type { DescribedListener, ListenerGroup } from "./listener-info";
import type { ServiceHealth } from "./service-health";
import type { ServiceAction, Transition } from "./service-transition";
import type { OrderedGroup, ServicesOrder } from "./services-order";
import { servicesClient } from "../../lib/services-client";
import { WakeButton } from "../power/wake-switch";
import { useToastStore } from "../../store/toast-store";
import { groupListeners } from "./listener-info";
import { deriveServiceHealth } from "./service-health";
import { resolveServiceIcon, SERVICE_ICONS } from "./service-icon";
import { TRANSITION_LABEL, transitionStatus } from "./service-transition";
import { applyOrder, moveGroup, moveService, toOrder } from "./services-order";

const SERVICES_QUERY_KEY = ["services"] as const;
/** Last service whose logs were shown; a per-viewer convenience only. */
const SELECTED_STORAGE_KEY = "atelier.services.selectedLog";

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSelected(id: string) {
  try {
    localStorage.setItem(SELECTED_STORAGE_KEY, id);
  } catch {
    // Storage can be unavailable; the pane still works for this session.
  }
}
const ORDER_QUERY_KEY = ["services-order"] as const;

// dnd-kit scrolls when the pointer is within 20% of the scroll area's edge by
// default; in this tall panel that is ~140px, and dragging a row to the top
// of the list scrolled it away from the drop target.
const AUTO_SCROLL = { threshold: { x: 0, y: 0.06 } };

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
  unmanaged: { dot: "bg-violet-500", label: "Outside Atelier" },
};

function describeProbe(service: ServiceStatus): string | null {
  const { health } = service;
  if (!health) return null;
  if (health.statusCode !== null) {
    return `HTTP ${health.statusCode} · ${health.latencyMs}ms`;
  }
  return health.error;
}

/**
 * Text for the status column. Up and down already read from the dot, so they
 * get none; the rest says what is unusual about the service.
 */
function statusNote(
  health: ServiceHealth,
  service: ServiceStatus,
): string | null {
  switch (health) {
    case "up":
    case "down":
      return null;
    case "crashed":
      return service.launchd?.lastExitCode
        ? `Crashed · exit ${service.launchd.lastExitCode}`
        : "Crashed";
    case "degraded":
      return describeProbe(service) ?? "Degraded";
    case "starting":
    case "unmanaged":
      return HEALTH_STYLE[health].label;
  }
}

function ServiceIcon({ name }: { name: keyof typeof SERVICE_ICONS }) {
  const Icon = SERVICE_ICONS[name];
  return (
    <Icon
      className="size-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
  );
}

/** Sortable wrapper: the item moves as a whole, but only `handle` starts a drag. */
type DragBindings = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
> & { isDragging: boolean };

/**
 * Sortable wrapper: the child spreads `drag` on whatever should start a
 * drag (a whole service row, a group header). A pointer must travel a few
 * pixels first (see useSortSensors), so a plain click still clicks.
 */
function Sortable({
  id,
  children,
}: {
  id: string;
  children: (drag: DragBindings) => ReactNode;
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

  // Releasing the pointer after a drag still fires a click on the row under
  // it; swallow that one click so a reorder does not also toggle the logs.
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) draggedRef.current = true;
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      className={
        isDragging ? "relative z-10 cursor-grabbing opacity-80" : undefined
      }
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onPointerDownCapture={() => {
        draggedRef.current = false;
      }}
      onClickCapture={(event) => {
        if (draggedRef.current) {
          draggedRef.current = false;
          event.stopPropagation();
          event.preventDefault();
        }
      }}
    >
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}

function useSortSensors() {
  return useSensors(
    // A few pixels of travel before a drag starts, so clicks stay clicks.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space picks a row up; Enter stays "toggle logs".
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    }),
  );
}

function ServiceRow({
  service,
  selected,
  onSelect,
  drag,
  transition,
  onTransition,
}: {
  service: ServiceStatus;
  selected: boolean;
  onSelect: () => void;
  /** Makes the whole row the drag source. */
  drag: DragBindings;
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
  // Opening a page that refuses connections only shows a browser error.
  const answers =
    health === "up" || health === "degraded" || health === "unmanaged";
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
      // With a stop_cmd the backend runs it instead of signalling the port's
      // holder (often a container runtime), so say which command will run.
      const how = def.stop_cmd
        ? `Run \`${def.stop_cmd}\``
        : "Stop that process";
      const confirmed = await ask(
        `${def.name ?? def.id} is running outside Atelier (pid ${pid ?? "?"}). ` +
          (kind === "stop"
            ? `${how}?`
            : `${how} and restart it under Atelier?`),
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
  const note = transition
    ? TRANSITION_LABEL[transition.action]
    : statusNote(health, service);
  // Full detail stays one hover away on the dot.
  const detail = [
    label,
    pid === null ? null : `pid ${pid}`,
    describeProbe(service),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      ref={drag.setActivatorNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      {...(hasLog
        ? {
            role: "button",
            tabIndex: 0,
            "aria-pressed": selected,
            "aria-label": `Show logs for ${def.name ?? def.id}`,
            onClick: onSelect,
          }
        : {})}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        // Space goes to the drag sensor (pick up / drop the row).
        const dragKeyDown = drag.listeners?.onKeyDown as
          ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
        dragKeyDown?.(event);
        // Enter toggles the logs, but only on the row itself: Enter on a
        // nested button runs that button.
        if (
          hasLog &&
          event.key === "Enter" &&
          event.target === event.currentTarget
        ) {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`flex touch-none items-center gap-3 rounded-lg border px-3 py-2 transition-colors select-none ${selected ? "border-primary/50 bg-primary/5" : "bg-card"} ${hasLog ? "cursor-pointer hover:bg-muted/40" : "cursor-grab"} outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      <span
        className={`size-2.5 shrink-0 rounded-full transition-colors ${dot}`}
        title={detail}
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
        <div className="flex items-center gap-2" title={detail}>
          <span className="truncate text-sm font-medium">
            {def.name ?? def.id}
          </span>
          {def.port === null ? null : (
            <span
              className={`shrink-0 rounded-md border px-1.5 py-px font-mono text-xs tabular-nums ${
                service.listener
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-border bg-muted/40 text-muted-foreground"
              }`}
              title={
                service.listener
                  ? `localhost:${def.port}, in use by pid ${service.listener.pid} (${service.listener.command})`
                  : `localhost:${def.port}, free`
              }
            >
              :{def.port}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{def.kind}</span>
          {/* Its routines are what the daily wake is for. */}
          {def.id === "openmausbot" ? <WakeButton /> : null}
        </div>
      </div>

      {note === null ? null : (
        <span
          className={`max-w-40 shrink-0 truncate text-xs ${
            busy
              ? "text-foreground"
              : health === "crashed"
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
          }`}
          title={note}
        >
          {note}
        </span>
      )}

      {/* Actions keep their own behavior instead of also toggling the logs. */}
      <div
        // Room for Open + Restart + Stop, so buttons and the status text line
        // up across rows whatever subset a row shows.
        className="flex w-[84px] shrink-0 items-center justify-end gap-1"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        // Pressing a button must not start dragging the row.
        onPointerDown={(event) => event.stopPropagation()}
      >
        {def.url && answers ? (
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
      <header className="border-b px-4 py-2 text-xs text-muted-foreground">
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

const NO_KNOWN: KnownListener[] = [];

function ListenerRow({ item }: { item: DescribedListener }) {
  const { listener, note } = item;
  // Everything known about the process, one hover away.
  const detail = [
    `pid ${listener.pid}`,
    listener.exe,
    listener.launchdPlist,
    listener.cwd ? `cwd ${listener.cwd}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div
      className="flex gap-3 text-xs whitespace-nowrap text-muted-foreground"
      title={detail}
    >
      <span className="w-14 shrink-0 text-right font-mono tabular-nums">
        :{listener.port}
      </span>
      <span className="w-28 shrink-0 truncate font-mono text-foreground/80">
        {listener.command}
      </span>
      <span className="truncate">{note}</span>
    </div>
  );
}

function ListenerGroups({ groups }: { groups: ListenerGroup[] }) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.name} className="flex flex-col gap-1">
          <span className="text-xs font-medium">{group.name}</span>
          {group.listeners.map((item) => (
            <ListenerRow
              key={`${item.listener.pid}:${item.listener.port}`}
              item={item}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function UnregisteredListeners({
  listeners,
  known,
}: {
  listeners: Listener[];
  known: KnownListener[];
}) {
  const { visible, hidden } = useMemo(
    () => groupListeners(listeners, known),
    [listeners, known],
  );
  if (listeners.length === 0) return null;
  const hiddenCount = hidden.reduce((n, g) => n + g.listeners.length, 0);
  return (
    <details className="mt-6" open>
      <summary className="cursor-pointer text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Other listening ports ({listeners.length})
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <ListenerGroups groups={visible} />
        {hiddenCount === 0 ? null : (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              macOS and hidden ({hiddenCount})
            </summary>
            <div className="mt-2">
              <ListenerGroups groups={hidden} />
            </div>
          </details>
        )}
      </div>
    </details>
  );
}

export function ServicesPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(readSelected);
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

  // The log pane is always there; it shows the chosen service, or the first
  // one with a log until something is chosen (or the choice was removed).
  const logServiceId = useMemo(() => {
    const withLogs = groups
      .flatMap((group) => group.services)
      .filter((service) => service.logPath !== null);
    return (
      withLogs.find((service) => service.def.id === selectedId)?.def.id ??
      withLogs[0]?.def.id ??
      null
    );
  }, [groups, selectedId]);

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
          <span className="truncate text-xs text-muted-foreground">
            {snapshot.data?.configPath}
          </span>
          <div className="ml-auto flex items-center gap-1">
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
          <p className="text-sm text-destructive">{String(snapshot.error)}</p>
        ) : null}
        {snapshot.data?.configError ? (
          <p className="mb-4 rounded-md border border-current/30 px-3 py-2 font-mono text-xs text-destructive">
            {snapshot.data.configError}
          </p>
        ) : null}

        {/* Groups and each group's services are separate drag contexts, so a
            service can only be dropped within its own group. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          autoScroll={AUTO_SCROLL}
          onDragEnd={handleGroupDragEnd}
        >
          <SortableContext
            items={groups.map((group) => group.name)}
            strategy={verticalListSortingStrategy}
          >
            {groups.map((group) => (
              <Sortable key={group.name} id={group.name}>
                {(groupDrag) => (
                  <div className="mb-5">
                    <h3
                      ref={groupDrag.setActivatorNodeRef}
                      {...groupDrag.attributes}
                      {...groupDrag.listeners}
                      aria-label={`Group ${group.name}, drag to reorder`}
                      className="mb-2 flex w-fit cursor-grab touch-none items-center gap-1 rounded text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    >
                      {group.name}
                    </h3>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      modifiers={[restrictToVerticalAxis]}
                      autoScroll={AUTO_SCROLL}
                      onDragEnd={handleServiceDragEnd}
                    >
                      <SortableContext
                        items={group.services.map((service) => service.def.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="flex flex-col gap-2">
                          {group.services.map((service) => (
                            <Sortable key={service.def.id} id={service.def.id}>
                              {(drag) => (
                                <ServiceRow
                                  service={service}
                                  drag={drag}
                                  transition={transitions[service.def.id]}
                                  onTransition={(transition) =>
                                    setTransition(service.def.id, transition)
                                  }
                                  selected={service.def.id === logServiceId}
                                  onSelect={() => {
                                    setSelectedId(service.def.id);
                                    writeSelected(service.def.id);
                                  }}
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

        <UnregisteredListeners
          listeners={snapshot.data?.unregistered ?? []}
          known={snapshot.data?.known ?? NO_KNOWN}
        />
      </section>

      {logServiceId ? (
        <LogPane key={logServiceId} serviceId={logServiceId} />
      ) : (
        <section className="flex w-1/2 shrink-0 items-center justify-center border-l text-xs text-muted-foreground">
          No service with a log yet.
        </section>
      )}
    </div>
  );
}
