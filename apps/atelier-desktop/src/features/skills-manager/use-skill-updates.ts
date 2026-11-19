import { useCallback, useEffect, useRef, useState } from "react";

import { checkSkillUpdates, updateSkill } from "../../lib/tauri";

export interface SkillUpdates {
  /** Skills with a newer version upstream; null until the first check ends. */
  outdated: Set<string> | null;
  checking: boolean;
  /** Why the last check failed (offline, GitHub rate limit…), else null. */
  error: string | null;
  /** The skill being updated right now, else null. */
  updating: string | null;
  check: () => void;
  /** Updates in sequence (each rewrites the shared lock file); resolves to the names that failed. */
  update: (skillNames: string[]) => Promise<string[]>;
}

/**
 * Asks skills.sh which skills are behind upstream. It checks once when
 * `active` first turns true, then only on request: every check is one GitHub
 * API call per source repo, and unauthenticated calls cap at 60 an hour.
 */
export function useSkillUpdates(active: boolean): SkillUpdates {
  const [outdated, setOutdated] = useState<Set<string> | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const checked = useRef(false);

  const check = useCallback(() => {
    setChecking(true);
    setError(null);
    checkSkillUpdates()
      .then((names) => setOutdated(new Set(names)))
      .catch((error_: unknown) => {
        console.error("Failed to check skill updates:", error_);
        setError(error_ instanceof Error ? error_.message : String(error_));
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!active || checked.current) return;
    checked.current = true;
    check();
  }, [active, check]);

  const update = useCallback(async (skillNames: string[]) => {
    const failed: string[] = [];
    for (const name of skillNames) {
      setUpdating(name);
      try {
        await updateSkill(name);
        setOutdated((current) => {
          if (!current) return current;
          const next = new Set(current);
          next.delete(name);
          return next;
        });
      } catch (error_: unknown) {
        console.error(`Failed to update ${name}:`, error_);
        failed.push(name);
      }
    }
    setUpdating(null);
    return failed;
  }, []);

  return { outdated, checking, error, updating, check, update };
}
