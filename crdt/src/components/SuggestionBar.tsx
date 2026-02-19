import { useState, useEffect, useCallback } from "react";

interface SuggestionInfo {
  readonly id: string;
  readonly insertText: string;
  readonly deleteText: string;
}

export function SuggestionBar() {
  const [suggestions, setSuggestions] = useState<SuggestionInfo[]>([]);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch("/api/doc/suggestions");
      const data = (await res.json()) as { suggestions: SuggestionInfo[] };
      setSuggestions(data.suggestions ?? []);
    } catch {
      // ignore fetch errors
    }
  }, []);

  useEffect(() => {
    fetchSuggestions();
    const interval = setInterval(fetchSuggestions, 2000);
    return () => clearInterval(interval);
  }, [fetchSuggestions]);

  const handleAccept = async (id: string) => {
    await fetch(`/api/doc/suggest/${id}/accept`, { method: "POST" });
    await fetchSuggestions();
  };

  const handleReject = async (id: string) => {
    await fetch(`/api/doc/suggest/${id}/reject`, { method: "POST" });
    await fetchSuggestions();
  };

  const handleAcceptAll = async () => {
    for (const s of suggestions) {
      await fetch(`/api/doc/suggest/${s.id}/accept`, { method: "POST" });
    }
    await fetchSuggestions();
  };

  const handleRejectAll = async () => {
    for (const s of suggestions) {
      await fetch(`/api/doc/suggest/${s.id}/reject`, { method: "POST" });
    }
    await fetchSuggestions();
  };

  if (suggestions.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          {suggestions.length} pending suggestion{suggestions.length !== 1 ? "s" : ""}
        </span>
        <div className="flex gap-2">
          <button
            className="inline-flex items-center justify-center rounded-md border bg-background px-3 h-8 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
            onClick={handleAcceptAll}
          >
            Accept All
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md border bg-background px-3 h-8 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
            onClick={handleRejectAll}
          >
            Reject All
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded border px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-1 min-w-0 flex-1 mr-2">
              {s.deleteText && (
                <span
                  className="line-through truncate"
                  style={{ background: "rgba(239,68,68,0.2)" }}
                >
                  {s.deleteText}
                </span>
              )}
              {s.deleteText && s.insertText && (
                <span className="text-muted-foreground mx-1">&rarr;</span>
              )}
              {s.insertText && (
                <span className="truncate" style={{ background: "rgba(34,197,94,0.2)" }}>
                  {s.insertText}
                </span>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                className="inline-flex items-center justify-center rounded-md border bg-background px-3 h-8 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleAccept(s.id)}
              >
                Accept
              </button>
              <button
                className="inline-flex items-center justify-center rounded-md border bg-background px-3 h-8 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleReject(s.id)}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
