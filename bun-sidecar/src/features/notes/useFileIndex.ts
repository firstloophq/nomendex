import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    applyDocOperation,
    createClock,
    createDocManager,
    createOperationId,
    getDoc,
    getFields,
    increment,
    receive,
} from "@firstloophq-demos/crdt-lib";
import type { DocManager, FieldOp, LamportClock, RecordOp } from "@firstloophq-demos/crdt-lib";
import { useCollab } from "@/contexts/CollabContext";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { notesAPI } from "@/hooks/useNotesAPI";
import { crdtDebugLog, summarizeOpsForDebug } from "@-demos/crdt-lib/crdt-debug";
import {
    buildFileIndexDocId,
    getWorkspaceCollabScope,
} from "@-demos/crdt-lib/collab-doc-id";

// --- Constants ---

const FILE_PREFIX = "f:";
const DIR_PREFIX = "d:";
const DELETED_SENTINEL = "";

// --- Types ---

interface FileIndexState {
    manager: DocManager;
    clock: LamportClock;
}

interface FileEntry {
    fileName: string;
    folderPath: string | undefined;
}

interface FolderEntry {
    name: string;
    path: string;
}

export interface FileIndexAPI {
    files: ReadonlyArray<FileEntry>;
    folders: ReadonlyArray<FolderEntry>;
    isSynced: boolean;
    addFile: (params: { path: string }) => void;
    removeFile: (params: { path: string }) => void;
    renameFile: (params: { oldPath: string; newPath: string }) => void;
    addFolder: (params: { path: string }) => void;
    removeFolder: (params: { path: string }) => void;
    renameFolder: (params: { oldPath: string; newPath: string }) => void;
}

// --- Helpers ---

function extractRemoteClock(op: RecordOp): number | null {
    if ("id" in op && op.id && typeof op.id.clock === "number") {
        return op.id.clock;
    }
    return null;
}

function nextId(clock: LamportClock): { clock: LamportClock; id: { clientId: string; clock: number }; timestamp: { clientId: string; clock: number } } {
    const { clock: newClock, timestamp } = increment({ clock });
    return {
        clock: newClock,
        id: createOperationId({ clientId: clock.clientId, clock: timestamp.clock }),
        timestamp,
    };
}

function buildFieldOp(params: {
    clock: LamportClock;
    fieldName: string;
    value: string;
}): { clock: LamportClock; op: FieldOp } {
    const { clock: newClock, id, timestamp } = nextId(params.clock);
    return {
        clock: newClock,
        op: {
            type: "field" as const,
            id,
            fieldName: params.fieldName,
            value: params.value,
            timestamp,
        },
    };
}

/**
 * Converts a note fileName + optional folderPath into the relative path
 * used as the CRDT field key (without the "f:" prefix).
 *
 * e.g. fileName="spec.md", folderPath="projects" → "projects/spec.md"
 *      fileName="readme.md", folderPath=undefined → "readme.md"
 */
function noteToRelativePath(params: { fileName: string; folderPath: string | undefined }): string {
    if (params.folderPath) {
        return `${params.folderPath}/${params.fileName}`;
    }
    return params.fileName;
}

/**
 * Parses a relative path back into fileName + folderPath.
 *
 * e.g. "projects/spec.md" → { fileName: "spec.md", folderPath: "projects" }
 *      "readme.md"        → { fileName: "readme.md", folderPath: undefined }
 */
function relativePathToNote(relativePath: string): FileEntry {
    const lastSlash = relativePath.lastIndexOf("/");
    if (lastSlash === -1) {
        return { fileName: relativePath, folderPath: undefined };
    }
    return {
        fileName: relativePath.slice(lastSlash + 1),
        folderPath: relativePath.slice(0, lastSlash),
    };
}

// --- Noop API for disabled state ---

const EMPTY_FILES: ReadonlyArray<FileEntry> = [];
const EMPTY_FOLDERS: ReadonlyArray<FolderEntry> = [];
const noop = () => {};

const DISABLED_API: FileIndexAPI = {
    files: EMPTY_FILES,
    folders: EMPTY_FOLDERS,
    isSynced: false,
    addFile: noop,
    removeFile: noop,
    renameFile: noop,
    addFolder: noop,
    removeFolder: noop,
    renameFolder: noop,
};

// --- Hook ---

export function useFileIndex(params: { enabled: boolean }): FileIndexAPI {
    const { enabled } = params;
    const collab = useCollab();
    const collabClientId = collab?.clientId;
    const collabSubscribeDoc = collab?.subscribeDoc;
    const collabSendOps = collab?.sendOps;
    const { activeWorkspace, appMode } = useWorkspaceSwitcher();

    const collabScope = useMemo(
        () => getWorkspaceCollabScope({ activeWorkspace }),
        [activeWorkspace],
    );

    const fileIndexDocId = useMemo(
        () => buildFileIndexDocId({ scope: collabScope, namespace: "notes" }),
        [collabScope],
    );

    const collabEnabled = enabled
        && appMode === "team"
        && !!collabClientId
        && !!collabSubscribeDoc
        && !!collabSendOps;

    const [state, setState] = useState<FileIndexState>(() => ({
        manager: createDocManager(),
        clock: createClock({ clientId: collabClientId ?? "fileindex-local" }),
    }));
    const [isSynced, setIsSynced] = useState(false);

    const stateRef = useRef<FileIndexState>(state);
    stateRef.current = state;

    const bootstrapAttemptedRef = useRef<string | null>(null);

    // Reset bootstrap guard when docId changes
    useEffect(() => {
        bootstrapAttemptedRef.current = null;
    }, [fileIndexDocId]);

    // --- handleIncomingOps ---
    const handleIncomingOps = useCallback((incoming: {
        docId: string;
        ops: ReadonlyArray<RecordOp>;
    }) => {
        setState((previous) => {
            let manager = previous.manager;
            let clock = previous.clock;

            for (const op of incoming.ops) {
                manager = applyDocOperation({
                    manager,
                    docId: incoming.docId,
                    op,
                });
                const remoteClock = extractRemoteClock(op);
                if (remoteClock !== null) {
                    clock = receive({ clock, remoteCounter: remoteClock });
                }
            }

            return { manager, clock };
        });
    }, []);

    // --- applyAndBroadcast ---
    const applyAndBroadcast = useCallback((broadcastParams: {
        nextState: FileIndexState;
        pendingOps: ReadonlyArray<{ docId: string; op: RecordOp }>;
        reason: string;
    }) => {
        setState(broadcastParams.nextState);
        if (!collabEnabled || !collabSendOps) return;
        if (broadcastParams.pendingOps.length === 0) return;

        const byDoc = new Map<string, RecordOp[]>();
        for (const { docId, op } of broadcastParams.pendingOps) {
            let list = byDoc.get(docId);
            if (!list) {
                list = [];
                byDoc.set(docId, list);
            }
            list.push(op);
        }

        for (const [docId, ops] of byDoc) {
            collabSendOps({ docId, ops });
        }

        crdtDebugLog({
            event: "fileindex_local_ops_sent",
            data: {
                fileIndexDocId,
                reason: broadcastParams.reason,
                docCount: byDoc.size,
                opCount: broadcastParams.pendingOps.length,
                ops: summarizeOpsForDebug(broadcastParams.pendingOps.map((entry) => entry.op)),
            },
        });
    }, [fileIndexDocId, collabEnabled, collabSendOps]);

    // --- Subscribe to doc ---
    useEffect(() => {
        if (!collabEnabled || !collabSubscribeDoc || !collabClientId) {
            return;
        }

        setState({
            manager: createDocManager(),
            clock: createClock({ clientId: collabClientId }),
        });
        setIsSynced(false);

        const unsubscribe = collabSubscribeDoc({
            docId: fileIndexDocId,
            onOps: ({ docId, ops }) => {
                handleIncomingOps({ docId, ops });
            },
            onSyncComplete: () => {
                setIsSynced(true);
                crdtDebugLog({
                    event: "fileindex_sync_complete",
                    data: { fileIndexDocId },
                });
            },
        });

        return () => {
            unsubscribe();
        };
    }, [fileIndexDocId, collabClientId, collabEnabled, collabSubscribeDoc, handleIncomingOps]);

    // --- Derive files and folders from CRDT state ---
    const files = useMemo<ReadonlyArray<FileEntry>>(() => {
        if (!collabEnabled) return EMPTY_FILES;
        const record = getDoc({ manager: state.manager, docId: fileIndexDocId });
        if (!record) return EMPTY_FILES;

        const fields = getFields({ record });
        const result: FileEntry[] = [];
        for (const [key, value] of fields) {
            if (!key.startsWith(FILE_PREFIX)) continue;
            if (value === DELETED_SENTINEL) continue;
            const relativePath = key.slice(FILE_PREFIX.length);
            result.push(relativePathToNote(relativePath));
        }
        return result;
    }, [collabEnabled, state.manager, fileIndexDocId]);

    const folders = useMemo<ReadonlyArray<FolderEntry>>(() => {
        if (!collabEnabled) return EMPTY_FOLDERS;
        const record = getDoc({ manager: state.manager, docId: fileIndexDocId });
        if (!record) return EMPTY_FOLDERS;

        const fields = getFields({ record });
        const result: FolderEntry[] = [];
        for (const [key, value] of fields) {
            if (!key.startsWith(DIR_PREFIX)) continue;
            if (value === DELETED_SENTINEL) continue;
            const folderPath = key.slice(DIR_PREFIX.length);
            const lastSlash = folderPath.lastIndexOf("/");
            const name = lastSlash === -1 ? folderPath : folderPath.slice(lastSlash + 1);
            result.push({ name, path: folderPath });
        }
        return result;
    }, [collabEnabled, state.manager, fileIndexDocId]);

    // --- Mutation helpers ---

    /** Produce a set of FieldOps and apply them to state + manager */
    const applyFieldOps = useCallback((fieldParams: {
        entries: ReadonlyArray<{ fieldName: string; value: string }>;
        reason: string;
    }) => {
        if (!collabEnabled) return;

        let { manager, clock } = stateRef.current;
        const pendingOps: Array<{ docId: string; op: RecordOp }> = [];

        for (const entry of fieldParams.entries) {
            const result = buildFieldOp({ clock, fieldName: entry.fieldName, value: entry.value });
            clock = result.clock;
            manager = applyDocOperation({ manager, docId: fileIndexDocId, op: result.op });
            pendingOps.push({ docId: fileIndexDocId, op: result.op });
        }

        applyAndBroadcast({
            nextState: { manager, clock },
            pendingOps,
            reason: fieldParams.reason,
        });
    }, [collabEnabled, fileIndexDocId, applyAndBroadcast]);

    const addFile = useCallback((addFileParams: { path: string }) => {
        const metadata = JSON.stringify({ createdAt: new Date().toISOString() });
        applyFieldOps({
            entries: [{ fieldName: `${FILE_PREFIX}${addFileParams.path}`, value: metadata }],
            reason: "add_file",
        });
    }, [applyFieldOps]);

    const removeFile = useCallback((removeFileParams: { path: string }) => {
        applyFieldOps({
            entries: [{ fieldName: `${FILE_PREFIX}${removeFileParams.path}`, value: DELETED_SENTINEL }],
            reason: "remove_file",
        });
    }, [applyFieldOps]);

    const renameFile = useCallback((renameFileParams: { oldPath: string; newPath: string }) => {
        const metadata = JSON.stringify({ createdAt: new Date().toISOString() });
        applyFieldOps({
            entries: [
                { fieldName: `${FILE_PREFIX}${renameFileParams.oldPath}`, value: DELETED_SENTINEL },
                { fieldName: `${FILE_PREFIX}${renameFileParams.newPath}`, value: metadata },
            ],
            reason: "rename_file",
        });
    }, [applyFieldOps]);

    const addFolder = useCallback((addFolderParams: { path: string }) => {
        const metadata = JSON.stringify({ createdAt: new Date().toISOString() });
        applyFieldOps({
            entries: [{ fieldName: `${DIR_PREFIX}${addFolderParams.path}`, value: metadata }],
            reason: "add_folder",
        });
    }, [applyFieldOps]);

    const removeFolder = useCallback((removeFolderParams: { path: string }) => {
        if (!collabEnabled) return;

        // Collect the folder itself plus all children under the folder prefix
        const record = getDoc({ manager: stateRef.current.manager, docId: fileIndexDocId });
        const entriesToDelete: Array<{ fieldName: string; value: string }> = [
            { fieldName: `${DIR_PREFIX}${removeFolderParams.path}`, value: DELETED_SENTINEL },
        ];

        if (record) {
            const fields = getFields({ record });
            const childPrefix = `${removeFolderParams.path}/`;
            for (const [key, value] of fields) {
                if (value === DELETED_SENTINEL) continue;
                if (key.startsWith(FILE_PREFIX)) {
                    const relativePath = key.slice(FILE_PREFIX.length);
                    if (relativePath.startsWith(childPrefix)) {
                        entriesToDelete.push({ fieldName: key, value: DELETED_SENTINEL });
                    }
                } else if (key.startsWith(DIR_PREFIX)) {
                    const folderPath = key.slice(DIR_PREFIX.length);
                    if (folderPath.startsWith(childPrefix)) {
                        entriesToDelete.push({ fieldName: key, value: DELETED_SENTINEL });
                    }
                }
            }
        }

        applyFieldOps({ entries: entriesToDelete, reason: "remove_folder" });
    }, [collabEnabled, fileIndexDocId, applyFieldOps]);

    const renameFolder = useCallback((renameFolderParams: { oldPath: string; newPath: string }) => {
        if (!collabEnabled) return;

        const record = getDoc({ manager: stateRef.current.manager, docId: fileIndexDocId });
        const entries: Array<{ fieldName: string; value: string }> = [];
        const metadata = JSON.stringify({ createdAt: new Date().toISOString() });

        // Delete old folder, create new folder
        entries.push({ fieldName: `${DIR_PREFIX}${renameFolderParams.oldPath}`, value: DELETED_SENTINEL });
        entries.push({ fieldName: `${DIR_PREFIX}${renameFolderParams.newPath}`, value: metadata });

        if (record) {
            const fields = getFields({ record });
            const oldChildPrefix = `${renameFolderParams.oldPath}/`;
            for (const [key, value] of fields) {
                if (value === DELETED_SENTINEL) continue;
                if (key.startsWith(FILE_PREFIX)) {
                    const relativePath = key.slice(FILE_PREFIX.length);
                    if (relativePath.startsWith(oldChildPrefix)) {
                        const newRelativePath = renameFolderParams.newPath + relativePath.slice(renameFolderParams.oldPath.length);
                        entries.push({ fieldName: key, value: DELETED_SENTINEL });
                        entries.push({ fieldName: `${FILE_PREFIX}${newRelativePath}`, value: metadata });
                    }
                } else if (key.startsWith(DIR_PREFIX)) {
                    const folderPath = key.slice(DIR_PREFIX.length);
                    if (folderPath.startsWith(oldChildPrefix)) {
                        const newFolderPath = renameFolderParams.newPath + folderPath.slice(renameFolderParams.oldPath.length);
                        entries.push({ fieldName: key, value: DELETED_SENTINEL });
                        entries.push({ fieldName: `${DIR_PREFIX}${newFolderPath}`, value: metadata });
                    }
                }
            }
        }

        applyFieldOps({ entries, reason: "rename_folder" });
    }, [collabEnabled, fileIndexDocId, applyFieldOps]);

    // --- Bootstrap from filesystem ---
    const bootstrapFromFiles = useCallback(async () => {
        if (!collabEnabled) return;
        if (!isSynced) return;
        if (bootstrapAttemptedRef.current === fileIndexDocId) return;

        bootstrapAttemptedRef.current = fileIndexDocId;

        let fileNotes: Array<{ fileName: string; folderPath?: string }> = [];
        let fileFolders: Array<{ name: string; path: string }> = [];
        try {
            const [notes, foldersResult] = await Promise.all([
                notesAPI.getNotes({}),
                notesAPI.getFolders({}),
            ]);
            fileNotes = notes;
            fileFolders = foldersResult;
        } catch (error) {
            crdtDebugLog({
                event: "fileindex_bootstrap_failed",
                level: "warn",
                data: {
                    fileIndexDocId,
                    reason: "file_load_failed",
                    error: error instanceof Error ? error.message : String(error),
                },
            });
            return;
        }

        if (fileNotes.length === 0 && fileFolders.length === 0) {
            return;
        }

        // Read existing CRDT fields to avoid duplicates
        const record = getDoc({ manager: stateRef.current.manager, docId: fileIndexDocId });
        const existingFields = record ? getFields({ record }) : new Map<string, string>();

        const entries: Array<{ fieldName: string; value: string }> = [];
        const metadata = JSON.stringify({ createdAt: new Date().toISOString() });

        // Bootstrap folders
        for (const folder of fileFolders) {
            const fieldName = `${DIR_PREFIX}${folder.path}`;
            const existing = existingFields.get(fieldName);
            // Only add if not present or was deleted
            if (existing === undefined || existing === DELETED_SENTINEL) {
                entries.push({ fieldName, value: metadata });
            }
        }

        // Bootstrap files
        for (const note of fileNotes) {
            const relativePath = noteToRelativePath({ fileName: note.fileName, folderPath: note.folderPath });
            const fieldName = `${FILE_PREFIX}${relativePath}`;
            const existing = existingFields.get(fieldName);
            if (existing === undefined || existing === DELETED_SENTINEL) {
                entries.push({ fieldName, value: metadata });
            }
        }

        if (entries.length > 0) {
            applyFieldOps({ entries, reason: "bootstrap_from_files" });
            crdtDebugLog({
                event: "fileindex_bootstrap_complete",
                data: {
                    fileIndexDocId,
                    filesAdded: entries.filter(e => e.fieldName.startsWith(FILE_PREFIX)).length,
                    foldersAdded: entries.filter(e => e.fieldName.startsWith(DIR_PREFIX)).length,
                },
            });
        }
    }, [collabEnabled, isSynced, fileIndexDocId, applyFieldOps]);

    useEffect(() => {
        void bootstrapFromFiles();
    }, [bootstrapFromFiles]);

    // --- Return ---
    if (!collabEnabled) {
        return DISABLED_API;
    }

    return {
        files,
        folders,
        isSynced,
        addFile,
        removeFile,
        renameFile,
        addFolder,
        removeFolder,
        renameFolder,
    };
}
