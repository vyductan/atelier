import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  Cloud,
  Cog,
  Container,
  Database,
  Globe,
  Server,
  Terminal,
} from "lucide-react";

import type { ServiceDef } from "../../lib/services-client";

/** Values accepted by `icon:` in services.yaml. */
export const SERVICE_ICONS = {
  database: Database,
  container: Container,
  "book-open": BookOpen,
  cloud: Cloud,
  cog: Cog,
  globe: Globe,
  terminal: Terminal,
  server: Server,
  bot: Bot,
} satisfies Record<string, LucideIcon>;

export type ServiceIconName = keyof typeof SERVICE_ICONS;

function isServiceIconName(value: string): value is ServiceIconName {
  return Object.hasOwn(SERVICE_ICONS, value);
}

function explicitIcon(def: ServiceDef): ServiceIconName | null {
  const explicit = def.icon?.trim().toLowerCase();
  return explicit && isServiceIconName(explicit) ? explicit : null;
}

export type ServiceIconSource =
  | { type: "image"; src: string }
  | { type: "icon"; name: ServiceIconName };

/**
 * What to draw for a service: an explicit `icon:` from services.yaml, else
 * the site's own favicon, else the icon inferred from kind/cmd.
 */
export function resolveServiceIcon(
  def: ServiceDef,
  favicon: string | null,
): ServiceIconSource {
  const explicit = explicitIcon(def);
  if (explicit) return { type: "icon", name: explicit };
  // The backend only ever sends data URLs; anything else is not ours to load.
  if (favicon?.startsWith("data:image/")) return { type: "image", src: favicon };
  return { type: "icon", name: inferServiceIcon(def) };
}

/**
 * Picks an icon for a service: an explicit, known `icon` wins, otherwise it is
 * inferred from `kind` and `cmd`. Rules run most specific first, because
 * `supabase start` and `docker compose up` are commands too and must not fall
 * through to the generic dev-server rule.
 */
export function inferServiceIcon(def: ServiceDef): ServiceIconName {
  const explicit = explicitIcon(def);
  if (explicit) return explicit;

  if (def.kind === "remote") return "cloud";
  if (def.kind === "launchd") return "cog";

  const cmd = def.cmd ?? "";
  if (/\bsupabase\b/.test(cmd)) return "database";
  if (/\bdocker(-compose|\s+compose)?\b/.test(cmd)) return "container";
  if (/\bstorybook\b/.test(cmd)) return "book-open";
  if (/\b(?:p?npm|yarn|bun)\s+(?:run\s+)?dev\b|\b(?:vite|next)\b/.test(cmd)) {
    return "globe";
  }
  return "terminal";
}
