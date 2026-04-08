import type { JSX } from "react";

interface ScheduleListItemProps {
  title: string;
  subtitle?: string;
  statusLabel?: string;
  isSelected?: boolean;
  onClick?: () => void;
  onRunNow?: () => void;
}

export function ScheduleListItem({
  title,
  subtitle,
  statusLabel,
  isSelected = false,
  onClick,
  onRunNow,
}: ScheduleListItemProps): JSX.Element {
  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full flex-col gap-1 px-3 py-2 text-left"
        data-selected={isSelected}
        onClick={onClick}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{title}</div>
          {statusLabel ? (
            <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
              {statusLabel}
            </span>
          ) : null}
        </div>
        {subtitle ? (
          <p className="text-muted-foreground text-xs">{subtitle}</p>
        ) : null}
      </button>
      {onRunNow ? (
        <div className="border-t px-3 py-2">
          <button type="button" className="text-xs font-medium" onClick={onRunNow}>
            Run now
          </button>
        </div>
      ) : null}
    </div>
  );
}
