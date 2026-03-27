import { useQuery } from "@tanstack/react-query";

import { listProjects } from "../lib/tauri";

/**
 * Hook to fetch all Claude Code projects with session counts
 */
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 30_000, // 30 seconds
    refetchOnMount: true,
  });
}
