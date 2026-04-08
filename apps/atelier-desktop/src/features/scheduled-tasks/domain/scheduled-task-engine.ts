import type {
  ScheduledTaskRunRecord,
  ScheduledTaskRunStatus,
  ScheduledTaskScheduleType,
} from "./scheduled-tasks";

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

export function computeDeterministicJitterMinutes(
  taskId: string,
  maxMinutes: number,
): number {
  const max = normalizePositiveInteger(maxMinutes);

  if (max === 0) {
    return 0;
  }

  let hash = 0;
  for (const character of taskId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash % (max + 1);
}

export function findMostRecentMissedSlot(input: {
  slots: string[];
  now: string;
  lookbackDays: number;
}): string | null {
  const nowTime = Date.parse(input.now);

  if (Number.isNaN(nowTime)) {
    return null;
  }

  const lookbackDays = normalizePositiveInteger(input.lookbackDays);
  const lookbackStartTime = nowTime - lookbackDays * 24 * 60 * 60 * 1000;

  let mostRecentEligibleSlot: string | null = null;
  let mostRecentEligibleTime = Number.NEGATIVE_INFINITY;

  for (const slot of input.slots) {
    const slotTime = Date.parse(slot);

    if (Number.isNaN(slotTime)) {
      continue;
    }

    if (slotTime > nowTime) {
      continue;
    }

    if (slotTime < lookbackStartTime) {
      continue;
    }

    if (slotTime > mostRecentEligibleTime) {
      mostRecentEligibleTime = slotTime;
      mostRecentEligibleSlot = slot;
    }
  }

  return mostRecentEligibleSlot;
}

const ACTIVE_RUN_STATUSES: ScheduledTaskRunStatus[] = [
  "queued",
  "preparing",
  "running",
  "stalled_for_permission",
];

function formatDatePartsInTimeZone(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  return { year, month, day, hour, minute };
}

function buildUtcSlotForLocalTime(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): string | null {
  let timestamp = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    0,
    0,
  );
  const targetTimestamp = timestamp;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zonedParts = formatDatePartsInTimeZone(new Date(timestamp), input.timeZone);
    if (zonedParts === null) {
      return null;
    }

    const observedTimestamp = Date.UTC(
      zonedParts.year,
      zonedParts.month - 1,
      zonedParts.day,
      zonedParts.hour,
      zonedParts.minute,
      0,
      0,
    );
    const difference = targetTimestamp - observedTimestamp;

    if (difference === 0) {
      return new Date(timestamp).toISOString();
    }

    timestamp += difference;
  }

  const resolvedParts = formatDatePartsInTimeZone(new Date(timestamp), input.timeZone);
  if (
    resolvedParts?.year === input.year &&
    resolvedParts.month === input.month &&
    resolvedParts.day === input.day &&
    resolvedParts.hour === input.hour &&
    resolvedParts.minute === input.minute
  ) {
    return new Date(timestamp).toISOString();
  }

  return null;
}

export function hasActiveRunForTask(
  runs: ScheduledTaskRunRecord[],
  taskId: string,
): boolean {
  return runs.some(
    (run) =>
      run.scheduledTaskId === taskId && ACTIVE_RUN_STATUSES.includes(run.status),
  );
}

export function buildCandidateSlots(input: {
  scheduleType: ScheduledTaskScheduleType;
  cron: string | null;
  timezone: string;
  now: string;
  lookbackDays: number;
}): string[] {
  if (input.scheduleType !== "daily" || input.cron === null) {
    return [];
  }

  const cronMatch = input.cron.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!cronMatch) {
    return [];
  }

  const minute = Number(cronMatch[1]);
  const hour = Number(cronMatch[2]);
  if (
    !Number.isInteger(minute) ||
    !Number.isInteger(hour) ||
    minute < 0 ||
    minute > 59 ||
    hour < 0 ||
    hour > 23
  ) {
    return [];
  }

  const nowDate = new Date(input.now);
  if (Number.isNaN(nowDate.getTime())) {
    return [];
  }

  const currentLocalDate = formatDatePartsInTimeZone(nowDate, input.timezone);
  if (currentLocalDate === null) {
    return [];
  }

  const lookbackDays = normalizePositiveInteger(input.lookbackDays);
  const slots: string[] = [];
  let candidateYear = currentLocalDate.year;
  let candidateMonth = currentLocalDate.month;
  let candidateDay = currentLocalDate.day;

  for (let dayOffset = 0; dayOffset <= lookbackDays; dayOffset += 1) {
    const slot = buildUtcSlotForLocalTime({
      year: candidateYear,
      month: candidateMonth,
      day: candidateDay,
      hour,
      minute,
      timeZone: input.timezone,
    });

    if (slot !== null) {
      slots.push(slot);
    }

    const previousDate = new Date(
      Date.UTC(candidateYear, candidateMonth - 1, candidateDay),
    );
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    candidateYear = previousDate.getUTCFullYear();
    candidateMonth = previousDate.getUTCMonth() + 1;
    candidateDay = previousDate.getUTCDate();
  }

  return slots;
}
