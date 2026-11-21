import { invoke } from "@tauri-apps/api/core";

// Mirrors src-tauri/src/features/power.

export interface WakeSchedule {
  /** A repeating wake or power-on event is set. */
  enabled: boolean;
  /** "HH:MM" (24h), when pmset's line could be read. */
  time: string | null;
  /** The line pmset printed. */
  raw: string | null;
}

/** The wake the OpenMausBot routines need: a few minutes before `routineTime`. */
export interface RoutineWake {
  time: string;
  routineName: string;
  routineTime: string;
  /** Every enabled daily routine, earliest first, as [time, name]. */
  daily: [string, string][];
}

export const powerClient = {
  /** null when no enabled daily routine exists. */
  getRoutineWake: () => invoke<RoutineWake | null>("get_routine_wake"),
  getWake: () => invoke<WakeSchedule>("get_wake_schedule"),
  /** Asks for the admin password in macOS's own dialog; rejects with "cancelled" on Cancel. */
  setWake: (enabled: boolean, time: string) =>
    invoke<WakeSchedule>("set_wake_schedule", { enabled, time }),
};
