import { Search, X } from "lucide-react";

import { useSessionStore } from "../store/session-store";

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useSessionStore();

  return (
    <div className="relative">
      <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
      <input
        type="text"
        placeholder="Search sessions..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="bg-background ring-offset-background focus-visible:ring-ring w-full rounded-md border py-2 pr-9 pl-9 text-sm outline-none focus-visible:ring-2"
      />
      {searchQuery && (
        <button
          onClick={() => setSearchQuery("")}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 rounded-sm"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
