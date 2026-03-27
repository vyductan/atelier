interface SessionErrorBannerProps {
  error: string | null;
}

export function SessionErrorBanner({
  error,
}: SessionErrorBannerProps) {
  if (!error) {
    return null;
  }

  return (
    <div className="border-b px-4 py-3">
      <div
        data-testid="session-error-banner"
        role="alert"
        className="border-warning/40 bg-warning/10 text-warning-foreground rounded-md border px-3 py-2 text-xs"
      >
        <div className="font-medium">Session error</div>
        <div className="truncate" title={error}>
          {error}
        </div>
      </div>
    </div>
  );
}
