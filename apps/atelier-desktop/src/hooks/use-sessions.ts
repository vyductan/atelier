import { useQuery } from "@tanstack/react-query";

import { getProjectSessions } from "../lib/tauri";

/**
 * Hook to fetch sessions for a specific project
 */
export function useSessions(escapedPath: string | null) {
  return useQuery({
    queryKey: ["sessions", escapedPath],
    queryFn: async () => {
      if (!escapedPath) return null;
      return await getProjectSessions(escapedPath);
    },
    enabled: !!escapedPath,
    staleTime: 30_000, // 30 seconds
  });
}
