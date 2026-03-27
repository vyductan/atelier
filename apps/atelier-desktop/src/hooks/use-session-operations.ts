import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteSession } from "../lib/tauri";
import { useToastStore } from "../store/toast-store";

interface DeleteSessionParams {
  sessionId: string;
  escapedPath: string;
  permanent: boolean;
}

/**
 * Hook for session operations (delete, trash)
 */
export function useSessionOperations() {
  const queryClient = useQueryClient();
  const { addToast } = useToastStore();

  const deleteMutation = useMutation({
    mutationFn: async ({
      sessionId,
      escapedPath,
      permanent,
    }: DeleteSessionParams) => {
      await deleteSession(sessionId, escapedPath, permanent);
      return { permanent };
    },
    onSuccess: ({ permanent }, { escapedPath }) => {
      // Show success toast
      addToast(
        permanent ? "Session deleted permanently" : "Session moved to trash",
        "success",
      );

      // Invalidate queries to refetch data
      queryClient.invalidateQueries({ queryKey: ["sessions", escapedPath] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => {
      addToast(`Failed to delete session: ${error.message}`, "error");
    },
  });

  return {
    deleteSession: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    deleteError: deleteMutation.error,
  };
}
