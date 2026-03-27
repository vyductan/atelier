export interface ConfirmSyncGateState {
  hasConfirmState: boolean;
  isSyncing: boolean;
  isConfirmPreviewLoading: boolean;
  hasConfirmPreviewError: boolean;
}

export const canConfirmSyncAction = ({
  hasConfirmState,
  isSyncing,
  isConfirmPreviewLoading,
  hasConfirmPreviewError,
}: ConfirmSyncGateState): boolean => {
  return (
    hasConfirmState &&
    !isSyncing &&
    !isConfirmPreviewLoading &&
    !hasConfirmPreviewError
  );
};
