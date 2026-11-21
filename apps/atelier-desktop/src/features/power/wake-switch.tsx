import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock } from "lucide-react";

import { Button } from "@acme/ui/components/button";
import { Popover } from "@acme/ui/components/popover";
import { Switch } from "@acme/ui/components/switch";
import { TimePicker } from "@acme/ui/components/time-picker";

import type { WakeSchedule } from "../../lib/power-client";
import { powerClient } from "../../lib/power-client";
import { useToastStore } from "../../store/toast-store";

const WAKE_QUERY_KEY = ["power", "wake"] as const;
const ROUTINE_WAKE_QUERY_KEY = ["power", "routine-wake"] as const;
/** Used only when OpenMausBot cannot be asked. */
const FALLBACK_WAKE_TIME = "08:55";

/**
 * Daily wake of this Mac (`pmset repeat wakeorpoweron`), so routines due while
 * it sleeps after the 00:00 run start on time. The time follows the
 * OpenMausBot routines (a few minutes before the first one after the night
 * runs); pmset needs root (a sudoers rule or the admin password), so when the routines
 * move, the popover offers the new time instead of applying it silently.
 */
export function WakeButton() {
  const queryClient = useQueryClient();
  const addToast = useToastStore((state) => state.addToast);
  const wake = useQuery({
    queryKey: WAKE_QUERY_KEY,
    queryFn: powerClient.getWake,
  });
  const routine = useQuery({
    queryKey: ROUTINE_WAKE_QUERY_KEY,
    queryFn: powerClient.getRoutineWake,
    refetchInterval: 5 * 60_000,
  });
  const routineTime = routine.data?.time;
  const [draftTime, setDraftTime] = useState<string | null>(null);
  const time =
    draftTime ?? wake.data?.time ?? routineTime ?? FALLBACK_WAKE_TIME;

  const save = useMutation({
    mutationFn: ({ enabled, at }: { enabled: boolean; at: string }) =>
      powerClient.setWake(enabled, at),
    onSuccess: (next: WakeSchedule) => {
      queryClient.setQueryData(WAKE_QUERY_KEY, next);
      setDraftTime(null);
    },
    onError: (error) => {
      if (String(error) !== "cancelled") {
        addToast(`Wake schedule: ${String(error)}`, "error");
      }
    },
  });

  const enabled = wake.data?.enabled ?? false;
  /** The routines moved since the wake was set. */
  const drifted = enabled && !!routineTime && wake.data?.time !== routineTime;
  const routineLine = routine.data
    ? `Routines: wake at ${routine.data.time}, before "${routine.data.routineName}" (${routine.data.routineTime}).`
    : routine.isError
      ? `Routines: ${String(routine.error)}`
      : routine.isSuccess
        ? "Routines: no daily OpenMausBot routine."
        : null;
  const settings = (
    <div className="flex w-56 flex-col gap-3 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span>Wake this Mac daily</span>
        <Switch
          size="small"
          aria-label="Wake this Mac every day"
          checked={enabled}
          loading={save.isPending || wake.isLoading}
          onChange={(checked) =>
            save.mutate({ enabled: checked, at: routineTime ?? time })
          }
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">At</span>
        <TimePicker
          size="small"
          format="HH:mm"
          value={time}
          disabled={save.isPending}
          className="w-24 shrink-0"
          onChange={(_value, text) => {
            if (!text) return;
            setDraftTime(text);
            if (enabled) save.mutate({ enabled: true, at: text });
          }}
        />
      </div>
      {routineLine ? (
        <p className="text-xs text-muted-foreground">{routineLine}</p>
      ) : null}
      {drifted && routineTime ? (
        <Button
          size="small"
          loading={save.isPending}
          onClick={() => save.mutate({ enabled: true, at: routineTime })}
        >
          Use {routineTime}
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {wake.data?.raw ?? "No daily wake set."} Changing it asks for the admin
        password unless /etc/sudoers.d/atelier-wake allows it.
      </p>
    </div>
  );

  return (
    // The row under it is draggable and toggles logs; clicks in the popover
    // bubble here through the portal, so stop them before they reach the row.
    <span
      className="inline-flex"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Popover trigger="click" placement="bottomLeft" content={settings}>
        <Button
          type="text"
          size="small"
          aria-label="Daily wake settings"
          title={
            drifted
              ? `Wakes daily at ${time}, routines need ${routineTime}`
              : enabled
                ? `Wakes daily at ${time}`
                : "Daily wake off"
          }
          icon={
            <AlarmClock
              className={`size-3.5 ${drifted ? "text-warning" : enabled ? "text-primary" : "text-muted-foreground"}`}
            />
          }
        >
          {enabled ? <span className="font-mono text-xs">{time}</span> : null}
        </Button>
      </Popover>
    </span>
  );
}
