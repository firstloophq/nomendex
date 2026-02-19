import { useState, useEffect, useCallback } from "react";
import { CRDTEditor } from "@/components/CRDTEditor";
import { SuggestionBar } from "@/components/SuggestionBar";
import { createEmptyDocument, applyOperation } from "@/crdt/core/apply-operations";
import { createClock, increment } from "@/crdt/core/lamport-clock";
import { createOperationId, createInsertOp } from "@/crdt/core/operations";

/**
 * Creates a shared initial CRDT doc with a single paragraph block.
 * Both editors start from this same state so they share the same block IDs.
 */
function createSharedInitialDoc() {
  let doc = createEmptyDocument();
  let clock = createClock({ clientId: "shared-init" });

  const { clock: newClock, timestamp } = increment({ clock });
  clock = newClock;

  const paragraphOp = createInsertOp({
    id: createOperationId({
      clientId: timestamp.clientId,
      clock: timestamp.clock,
    }),
    parentId: null,
    side: "right",
    content: { type: "block", blockType: "paragraph" },
  });

  doc = applyOperation({ doc, op: paragraphOp });
  return doc;
}

export function CollaborativeDemo() {
  const [initialDoc] = useState(createSharedInitialDoc);
  const [copied, setCopied] = useState(false);

  // Clear logs on mount
  useEffect(() => {
    fetch("/api/log/clear", { method: "POST" }).catch(() => {});
  }, []);

  const handleCopyState = useCallback(() => {
    const editorA = document.querySelector('[data-editor="Editor A"] .ProseMirror') as HTMLElement | null;
    const editorB = document.querySelector('[data-editor="Editor B"] .ProseMirror') as HTMLElement | null;

    const textA = editorA?.innerText ?? "(empty)";
    const textB = editorB?.innerText ?? "(empty)";

    const xml = `<field_one>${textA}</field_one>\n<field_two>${textB}</field_two>`;
    navigator.clipboard.writeText(xml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <SuggestionBar />
      <div className="flex justify-end">
        <button
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 h-8 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
          onClick={handleCopyState}
        >
          {copied ? "Copied!" : "Copy Editor State"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <CRDTEditor label="Editor A" docId="__collab__" initialDoc={initialDoc} />
        <CRDTEditor label="Editor B" docId="__collab__" initialDoc={initialDoc} />
      </div>
    </div>
  );
}
