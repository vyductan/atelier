/** Mirrors src-tauri/src/features/services/order.rs. */
export interface ServicesOrder {
  groups: string[];
  services: string[];
}

export const UNGROUPED = "Other";

/** Anything with a registry id and group: a ServiceStatus in the app. */
interface Orderable {
  def: { id: string; group: string | null };
}

export interface OrderedGroup<T extends Orderable> {
  name: string;
  services: T[];
}

/** Position in the saved list, or after every saved entry (keeping yaml order among those). */
function rank(saved: string[], key: string, fallback: number): number {
  const index = saved.indexOf(key);
  return index === -1 ? saved.length + fallback : index;
}

/**
 * Groups services and orders groups and services by the saved order.
 * Groups and services the saved order does not know (new in services.yaml)
 * go after the known ones, in services.yaml order; saved ids that no longer
 * exist are ignored.
 */
export function applyOrder<T extends Orderable>(
  services: T[],
  order: ServicesOrder | null | undefined,
): OrderedGroup<T>[] {
  const savedGroups = order?.groups ?? [];
  const savedServices = order?.services ?? [];

  const groups = new Map<string, T[]>();
  for (const service of services) {
    const name = service.def.group ?? UNGROUPED;
    groups.set(name, [...(groups.get(name) ?? []), service]);
  }

  const yamlGroupOrder = [...groups.keys()];
  return yamlGroupOrder
    .toSorted(
      (a, b) =>
        rank(savedGroups, a, yamlGroupOrder.indexOf(a)) -
        rank(savedGroups, b, yamlGroupOrder.indexOf(b)),
    )
    .map((name) => {
      const members = groups.get(name) ?? [];
      return {
        name,
        services: members.toSorted(
          (a, b) =>
            rank(savedServices, a.def.id, members.indexOf(a)) -
            rank(savedServices, b.def.id, members.indexOf(b)),
        ),
      };
    });
}

/** Snapshot of what is on screen, so the next save records every position. */
export function toOrder<T extends Orderable>(
  groups: OrderedGroup<T>[],
): ServicesOrder {
  return {
    groups: groups.map((group) => group.name),
    services: groups.flatMap((group) => group.services.map((s) => s.def.id)),
  };
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Drops group `active` where group `over` was. Unknown names change nothing. */
export function moveGroup<T extends Orderable>(
  groups: OrderedGroup<T>[],
  active: string,
  over: string,
): OrderedGroup<T>[] {
  const names = groups.map((group) => group.name);
  return move(groups, names.indexOf(active), names.indexOf(over));
}

/**
 * Drops service `active` where service `over` was, within one group.
 * A drop onto a service of another group changes nothing: groups come from
 * services.yaml, so moving between them is an edit there, not a drag.
 */
export function moveService<T extends Orderable>(
  groups: OrderedGroup<T>[],
  active: string,
  over: string,
): OrderedGroup<T>[] {
  return groups.map((group) => {
    const ids = group.services.map((service) => service.def.id);
    const from = ids.indexOf(active);
    const to = ids.indexOf(over);
    if (from === -1 || to === -1) return group;
    return { ...group, services: move(group.services, from, to) };
  });
}
