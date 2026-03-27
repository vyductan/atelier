import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { useToastStore } from "../store/toast-store";

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex w-80 items-center gap-3 rounded-lg border p-4 shadow-lg ${
            toast.type === "success"
              ? "border-green-500/20 bg-green-50 dark:bg-green-950"
              : toast.type === "error"
                ? "border-red-500/20 bg-red-50 dark:bg-red-950"
                : "border-blue-500/20 bg-blue-50 dark:bg-blue-950"
          }`}
        >
          {toast.type === "success" && (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
          )}
          {toast.type === "error" && (
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          )}
          {toast.type === "info" && (
            <Info className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
          )}

          <p className="flex-1 text-sm font-medium">{toast.message}</p>

          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 rounded-sm opacity-70 transition-opacity hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
