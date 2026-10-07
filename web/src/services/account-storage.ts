import { localForageStorage } from "@/lib/localforage-storage";
import { useUserStore } from "@/stores/use-user-store";

// JWT payload is used only to partition browser caches, never for authorization.
export function accountScope(token = useUserStore.getState().token): string {
    if (!token) return "";
    try {
        const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))).userId || "";
    } catch {
        return "";
    }
}

export function accountStorageKey(name: string, scope: string) {
    return scope ? `${name}:account:${scope}` : name;
}

export async function readAccountState<T>(name: string, scope: string): Promise<T | null> {
    const value = await localForageStorage.getItem(accountStorageKey(name, scope));
    return value ? (JSON.parse(value).state as T) : null;
}

export function waitForUserHydration() {
    if (useUserStore.persist.hasHydrated()) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = useUserStore.persist.onFinishHydration(() => { unsubscribe(); resolve(); });
        if (useUserStore.persist.hasHydrated()) { unsubscribe(); resolve(); }
    });
}

export const ACCOUNT_IMPORT_EVENT = "infinite-canvas:import-local-account-data";
export const ACCOUNT_SYNC_FAILED_EVENT = "infinite-canvas:account-sync-failed";

export function reportAccountSyncFailure(error: unknown) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ACCOUNT_SYNC_FAILED_EVENT, {
        detail: error instanceof Error ? error.message : "账号同步失败",
    }));
}

// Keep blobs referenced by guest data or another account's offline cache.
export async function cachedBrowserData() {
    const localforage = (await import("localforage")).default;
    const records: unknown[] = [];
    await localforage.iterate((value: unknown, key) => {
        if (!/^infinite-canvas:(canvas_store|asset_store)/.test(key) || typeof value !== "string") return;
        try { records.push(JSON.parse(value).state); } catch { /* Ignore unrelated or invalid cache values. */ }
    });
    return records;
}
