export type PermissionDecision = "allow" | "deny";

export type PermissionResponse = {
    decision: PermissionDecision;
    alwaysAllow?: boolean;
    toolName?: string;
};

export type PendingPermission = {
    resolve: (response: PermissionResponse) => void;
    toolName: string;
    input: Record<string, unknown>;
    createdAt: number;
};

// Global map to store pending permission requests
const pendingPermissions = new Map<string, PendingPermission>();

// Clean up stale permissions (older than 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [id, permission] of pendingPermissions.entries()) {
        if (now - permission.createdAt > 5 * 60 * 1000) {
            console.log(`[Permissions] Cleaning up stale permission: ${id}`);
            permission.resolve({ decision: "deny" });
            pendingPermissions.delete(id);
        }
    }
}, 60 * 1000);

export function requestPermission(
    permissionId: string,
    toolName: string,
    input: Record<string, unknown>
): Promise<PermissionResponse> {
    return new Promise<PermissionResponse>((resolve) => {
        pendingPermissions.set(permissionId, {
            resolve,
            toolName,
            input,
            createdAt: Date.now(),
        });
    });
}

export function resolvePermission(
    permissionId: string,
    response: PermissionResponse
): boolean {
    const pending = pendingPermissions.get(permissionId);
    if (!pending) return false;

    pending.resolve(response);
    pendingPermissions.delete(permissionId);
    return true;
}

export function hasPending(permissionId: string): boolean {
    return pendingPermissions.has(permissionId);
}
