import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";

import App from "./app";
import { ErrorBoundary } from "./components/error-boundary";

import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000, // 30 seconds
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.querySelector("#root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
