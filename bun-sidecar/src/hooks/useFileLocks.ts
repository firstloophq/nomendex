import { useCallback, useMemo, useSyncExternalStore } from "react";
import { FileLock } from "@/types/FileLock";

let locks = new Map<string, FileLock>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
    for (const listener of listeners) {
        listener();
    }
}

function setLocks(next: Map<string, FileLock>): void {
    locks = next;
    notifyListeners();
}

export function upsertFileLock(lock: FileLock): void {
    const next = new Map(locks);
    next.set(lock.noteFileName, lock);
    setLocks(next);
}

export function removeFileLock(noteFileName: string): void {
    if (!locks.has(noteFileName)) return;
    const next = new Map(locks);
    next.delete(noteFileName);
    setLocks(next);
}

export function clearFileLocks(): void {
    if (locks.size === 0) return;
    locks = new Map();
    notifyListeners();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot(): Map<string, FileLock> {
    return locks;
}

export function useFileLocks() {
    const lockMap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const locksList = useMemo(() => Array.from(lockMap.values()), [lockMap]);

    const isLocked = useCallback(
        (noteFileName: string) => lockMap.has(noteFileName),
        [lockMap]
    );

    const getLock = useCallback(
        (noteFileName: string) => lockMap.get(noteFileName) ?? null,
        [lockMap]
    );

    return {
        locks: locksList,
        isLocked,
        getLock,
    };
}
