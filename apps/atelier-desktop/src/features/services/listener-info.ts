import type { KnownListener, Listener } from "../../lib/services-client";

/** Group for executables macOS ships (rapportd, ControlCenter…). */
export const SYSTEM_GROUP = "macOS";

/**
 * Notes for ports that show up on most Macs. Entries in services.yaml
 * `known:` come first, so they override these.
 */
export const BUILTIN_KNOWN: KnownListener[] = [
  {
    match: { command: "rapportd" },
    note: "Continuity: Handoff, Universal Clipboard, Apple Watch unlock",
  },
  {
    match: { command: "ControlCenter", port: 5000 },
    note: "AirPlay Receiver (System Settings › General › AirDrop & Handoff)",
  },
  {
    match: { command: "ControlCenter", port: 7000 },
    note: "AirPlay Receiver (System Settings › General › AirDrop & Handoff)",
  },
  { match: { command: "sharingd" }, note: "AirDrop and sharing" },
  { match: { command: "ollama", port: 11434 }, note: "Ollama API" },
  {
    match: { command: "Google Chrome", port: 9222 },
    note: "Chrome remote debugging (DevTools protocol)",
  },
];

export interface DescribedListener {
  listener: Listener;
  group: string;
  /** What the process is: a note, else whatever identifies it best. */
  note: string | null;
  /** Folded into the collapsed list (macOS services, `hide: true`). */
  hidden: boolean;
}

export interface ListenerGroup {
  name: string;
  listeners: DescribedListener[];
}

function basename(path: string | null): string | null {
  return path ? (path.split("/").pop() ?? null) : null;
}

function matches(known: KnownListener, listener: Listener): boolean {
  const { command, port, label } = known.match;
  if (command && command !== listener.command) {
    if (command !== basename(listener.exe)) return false;
  }
  if (port != null && port !== listener.port) return false;
  if (label && label !== listener.launchdLabel) return false;
  // An entry with no criteria would claim every port.
  return Boolean(command || port != null || label);
}

export function describeListener(
  listener: Listener,
  known: KnownListener[],
): DescribedListener {
  const entry = [...known, ...BUILTIN_KNOWN].find((k) => matches(k, listener));
  const fallbackGroup = listener.system
    ? SYSTEM_GROUP
    : (listener.app ?? listener.command);
  const fallbackNote = listener.launchdLabel
    ? `launchd: ${listener.launchdLabel}`
    : listener.exe;
  return {
    listener,
    group: entry?.group ?? fallbackGroup,
    note: entry?.note ?? fallbackNote,
    hidden: entry?.hide ?? listener.system,
  };
}

/** Groups in order of their lowest port, listeners by port within a group. */
function group(described: DescribedListener[]): ListenerGroup[] {
  const groups = new Map<string, DescribedListener[]>();
  for (const item of described.toSorted(
    (a, b) =>
      a.listener.port - b.listener.port ||
      // One port, two sockets (a relay on another address): stable order.
      a.listener.command.localeCompare(b.listener.command),
  )) {
    groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  }
  return [...groups].map(([name, listeners]) => ({ name, listeners }));
}

export function groupListeners(
  listeners: Listener[],
  known: KnownListener[],
): { visible: ListenerGroup[]; hidden: ListenerGroup[] } {
  const described = listeners.map((l) => describeListener(l, known));
  return {
    visible: group(described.filter((d) => !d.hidden)),
    hidden: group(described.filter((d) => d.hidden)),
  };
}
