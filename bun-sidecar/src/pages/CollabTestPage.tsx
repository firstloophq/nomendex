import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import NotesView from "@/features/notes/note-view";
import { emit } from "@/lib/events";

const DEFAULT_DOC_ID = "shared";
const DEFAULT_USER_ID = "anonymous";
const TEST_TAB_ID = "collab-test-tab";

function sanitizeDocId(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
}

function sanitizeLabel(value: string): string {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9._:@-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
}

export function CollabTestPage() {
    const location = useLocation();

    const { docId, userId, noteFileName } = useMemo(() => {
        const params = new URLSearchParams(location.search);
        const rawDocId = params.get("doc") ?? DEFAULT_DOC_ID;
        const rawUserId = params.get("userId") ?? DEFAULT_USER_ID;

        const docId = sanitizeDocId(rawDocId) || DEFAULT_DOC_ID;
        const userId = sanitizeLabel(rawUserId) || DEFAULT_USER_ID;

        return {
            docId,
            userId,
            noteFileName: `collab-test/${docId}.md`,
        };
    }, [location.search]);

    useEffect(() => {
        window.localStorage.setItem("nomendex:crdt-debug", "1");
    }, []);

    const clearAll = () => {
        emit("notes:clearContent", { noteFileName });
    };

    return (
        <div className="h-full min-h-0 flex flex-col" data-testid="collab-test-page">
            <header className="shrink-0 border-b px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="text-base font-semibold">Collaborative Editor Test</h1>
                    <p className="text-xs text-muted-foreground truncate">
                        doc: <span data-testid="collab-doc-id">{docId}</span> | user: <span data-testid="collab-user-id">{userId}</span>
                    </p>
                </div>
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={clearAll}
                    data-testid="collab-clear-all"
                >
                    Clear all
                </Button>
            </header>

            <div className="flex-1 min-h-0" data-testid="collab-test-editor-wrap">
                <NotesView noteFileName={noteFileName} tabId={TEST_TAB_ID} compact autoFocus />
            </div>
        </div>
    );
}

export default CollabTestPage;
