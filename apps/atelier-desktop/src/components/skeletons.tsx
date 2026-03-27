export function ProjectListSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2">
          <div className="bg-muted h-4 w-4 animate-pulse rounded" />
          <div className="flex-1 space-y-2">
            <div className="bg-muted h-4 w-32 animate-pulse rounded" />
            <div className="bg-muted/60 h-3 w-48 animate-pulse rounded" />
          </div>
          <div className="bg-muted h-5 w-8 animate-pulse rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SessionTableSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header Skeleton */}
      <div className="bg-muted/50 border-b px-4 py-3">
        <div className="bg-muted h-6 w-48 animate-pulse rounded" />
        <div className="bg-muted/60 mt-2 h-4 w-32 animate-pulse rounded" />
      </div>

      {/* Table Skeleton */}
      <div className="flex-1 p-4">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-md border p-4"
            >
              <div className="bg-muted h-4 flex-1 animate-pulse rounded" />
              <div className="bg-muted/60 h-4 w-32 animate-pulse rounded" />
              <div className="bg-muted/60 h-4 w-20 animate-pulse rounded" />
              <div className="bg-muted/60 h-4 w-16 animate-pulse rounded" />
              <div className="flex gap-2">
                <div className="bg-muted/60 h-6 w-6 animate-pulse rounded" />
                <div className="bg-muted/60 h-6 w-6 animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
