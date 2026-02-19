import { useCallback } from "react";
import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { useTldrawCRDT } from "@/hooks/useTldrawCRDT";

export function TldrawRoom() {
  const { handleMount, isConnected, isSynced } = useTldrawCRDT();

  const onMount = useCallback(
    (editor: Editor) => {
      handleMount(editor);
    },
    [handleMount],
  );

  return (
    <div className="relative" style={{ height: "calc(100vh - 8rem)" }}>
      <div className="absolute top-2 right-2 z-50 flex gap-2 text-xs">
        <span
          className={`px-2 py-1 rounded ${
            isConnected ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
          }`}
        >
          {isConnected ? "Connected" : "Offline"}
        </span>
        {isConnected && !isSynced && (
          <span className="px-2 py-1 rounded bg-yellow-100 text-yellow-800">
            Syncing...
          </span>
        )}
      </div>
      <Tldraw onMount={onMount} />
    </div>
  );
}
