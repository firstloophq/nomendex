import type { WorkspaceInfo } from "@/hooks/useWorkspaceSwitcher";

export interface WorkspaceCollabScope {
    workspaceId: string;
    orgWorkspaceId?: string;
}

interface ParsedWorkspaceScopedDocId {
    scopeId: string;
    namespace: string;
    resourceId: string;
}

function encodeResource(value: string): string {
    return encodeURIComponent(value);
}

function decodeResource(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function resolveScopeId(params: WorkspaceCollabScope): string {
    const orgWorkspaceId = params.orgWorkspaceId?.trim();
    if (orgWorkspaceId) return orgWorkspaceId;

    const workspaceId = params.workspaceId.trim();
    return workspaceId || "unknown-workspace";
}

export function getWorkspaceCollabScope(params: {
    activeWorkspace: WorkspaceInfo | null;
}): WorkspaceCollabScope {
    return {
        workspaceId: params.activeWorkspace?.id ?? "unknown-workspace",
        orgWorkspaceId: params.activeWorkspace?.orgWorkspaceId,
    };
}

export function buildWorkspaceScopedDocId(params: {
    scope: WorkspaceCollabScope;
    namespace: string;
    resourceId: string;
}): string {
    const scopeId = resolveScopeId(params.scope);
    return `ws:${scopeId}:${params.namespace}:${encodeResource(params.resourceId)}`;
}

export function parseWorkspaceScopedDocId(params: {
    docId: string;
}): ParsedWorkspaceScopedDocId | null {
    const docId = params.docId.trim();
    if (!docId.startsWith("ws:")) return null;

    const firstColon = docId.indexOf(":", 3);
    if (firstColon <= 3) return null;

    const secondColon = docId.indexOf(":", firstColon + 1);
    if (secondColon <= firstColon + 1) return null;

    const scopeId = docId.slice(3, firstColon).trim();
    const namespace = docId.slice(firstColon + 1, secondColon).trim();
    const resourceId = decodeResource(docId.slice(secondColon + 1).trim());

    if (!scopeId || !namespace || !resourceId) return null;
    return { scopeId, namespace, resourceId };
}

export function isWorkspaceScopedDocId(params: { docId: string }): boolean {
    return parseWorkspaceScopedDocId(params) !== null;
}

function projectKeyForBoard(project: string | null): string {
    if (project === null) return "__all__";
    if (project === "") return "__none__";
    return project;
}

export function buildNoteDocId(params: {
    scope: WorkspaceCollabScope;
    noteFileName: string;
}): string {
    return buildWorkspaceScopedDocId({
        scope: params.scope,
        namespace: "note",
        resourceId: params.noteFileName,
    });
}

export function buildKanbanBoardDocId(params: {
    scope: WorkspaceCollabScope;
    project: string | null;
}): string {
    return buildWorkspaceScopedDocId({
        scope: params.scope,
        namespace: "kanban",
        resourceId: projectKeyForBoard(params.project),
    });
}

export function buildKanbanCardDocId(params: {
    scope: WorkspaceCollabScope;
    todoId: string;
}): string {
    return buildWorkspaceScopedDocId({
        scope: params.scope,
        namespace: "card",
        resourceId: params.todoId,
    });
}

export function todoIdFromKanbanCardDocId(params: {
    docId: string;
}): string {
    const parsed = parseWorkspaceScopedDocId({ docId: params.docId });
    if (parsed?.namespace === "card") {
        return parsed.resourceId;
    }
    return params.docId;
}
