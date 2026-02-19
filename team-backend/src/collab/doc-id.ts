export interface WorkspaceScopedDocId {
  orgWorkspaceId: string;
  namespace: string;
  resourceId: string;
}

/**
 * Team-mode doc IDs must follow:
 * ws:{orgWorkspaceId}:{namespace}:{resourceId...}
 */
export function parseWorkspaceScopedDocId(params: {
  docId: string;
}): WorkspaceScopedDocId | null {
  const docId = params.docId.trim();
  if (!docId.startsWith("ws:")) return null;

  const firstColon = docId.indexOf(":", 3);
  if (firstColon <= 3) return null;

  const secondColon = docId.indexOf(":", firstColon + 1);
  if (secondColon <= firstColon + 1) return null;

  const orgWorkspaceId = docId.slice(3, firstColon).trim();
  const namespace = docId.slice(firstColon + 1, secondColon).trim();
  const resourceId = docId.slice(secondColon + 1).trim();

  if (!orgWorkspaceId || !namespace || !resourceId) {
    return null;
  }

  return { orgWorkspaceId, namespace, resourceId };
}

