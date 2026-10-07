"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { fetchUserAssetData, syncUserAssetData } from "@/services/api/user-config";
import { accountScope, accountStorageKey, cachedBrowserData, readAccountState, reportAccountSyncFailure, waitForUserHydration } from "@/services/account-storage";
import { syncMediaReferences } from "@/services/sync-media";
import { useUserStore } from "@/stores/use-user-store";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes?: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    category?: string;
    source?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    assets: Asset[];
    deletedAssets: Record<string, string>;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    hydrateAccountAssets: (token: string, syncEnabled?: boolean) => Promise<void>;
    syncAccountAssets: (token: string) => Promise<void>;
    stopAccountAssetSync: () => void;
    cleanupImages: (extra?: unknown, storageKeys?: ReadonlyMap<string, string>, ownerToken?: string) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let activeAssetSyncToken = "";
let accountAssetSyncEnabled = false;
let isHydratingAccountAssets = false;
let syncTimer: number | null = null;

type AssetSnapshot = { assets: Asset[]; deletedAssets?: Record<string, string> };
let assetScope = "";
let assetHydration: { token: string; request: Promise<void> } | null = null;
let assetSync: { token: string; request: Promise<void> } | null = null;

export function mergeAssetSnapshots(remote: AssetSnapshot, local: AssetSnapshot): AssetSnapshot {
    const deletedAssets = { ...local.deletedAssets, ...remote.deletedAssets };
    const items = new Map<string, Asset>();
    for (const asset of [...local.assets, ...remote.assets]) {
        const previous = items.get(asset.id);
        if (!deletedAssets[asset.id] && (!previous || Date.parse(asset.updatedAt) >= Date.parse(previous.updatedAt))) items.set(asset.id, asset);
    }
    return { assets: Array.from(items.values()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), deletedAssets };
}

async function resolveStoredAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
    if (asset.kind === "audio" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
    if (asset.kind !== "image") return asset;
    if (asset.data.storageKey)
        return {
            ...asset,
            coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
            data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
        };
    if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
    const image = await uploadImage(asset.data.dataUrl, { localOnly: true });
    return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        await waitForUserHydration();
        assetScope = accountScope();
        const value = await localForageStorage.getItem(accountStorageKey(name, assetScope));
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(parsed.state.assets.map(resolveStoredAsset));
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(accountStorageKey(name, assetScope), JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(accountStorageKey(name, assetScope)),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            assets: [],
            deletedAssets: {},
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                scheduleAssetSync(get);
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => {
                    const assets = state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset));
                    window.setTimeout(() => scheduleAssetSync(get), 0);
                    return { assets };
                }),
            removeAsset: (id) =>
                set((state) => {
                    const deletedAsset = state.assets.find((asset) => asset.id === id);
                    const assets = state.assets.filter((asset) => asset.id !== id);

                    if (deletedAsset && deletedAsset.kind !== "text" && deletedAsset.data.storageKey && !deletedAsset.data.storageKey.startsWith("server:")) {
                        const key = deletedAsset.data.storageKey;
                        window.setTimeout(async () => {
                            const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
                            const usedKeys = new Set<string>();
                            // 收集其余资产的 storageKey
                            assets.forEach((a) => {
                                if (a.kind !== "text" && a.data.storageKey) usedKeys.add(a.data.storageKey);
                            });
                            // 收集画布中引用的 storageKey
                            const projects = useCanvasStore.getState().projects;
                            const { collectImageStorageKeys } = await import("@/services/image-storage");
                            const { collectMediaStorageKeys } = await import("@/services/file-storage");
                            collectImageStorageKeys(projects, usedKeys);
                            collectMediaStorageKeys(projects, usedKeys);
                            const cached = await cachedBrowserData();
                            collectImageStorageKeys(cached, usedKeys);
                            collectMediaStorageKeys(cached, usedKeys);

                            // 收集本地/云端生图历史与视频历史中的 storageKey，避免生成结果卡片失效
                            try {
                                const localforage = (await import("localforage")).default;
                                const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
                                await imageLogStore.iterate((log: any) => {
                                    if (log) {
                                        if (Array.isArray(log.images)) {
                                            log.images.forEach((img: any) => {
                                                if (img && img.storageKey) usedKeys.add(img.storageKey);
                                            });
                                        }
                                        if (Array.isArray(log.references)) {
                                            log.references.forEach((ref: any) => {
                                                if (ref && ref.storageKey) usedKeys.add(ref.storageKey);
                                            });
                                        }
                                    }
                                });
                            } catch (e) {
                                console.error("Error iterating image_generation_logs", e);
                            }

                            try {
                                const localforage = (await import("localforage")).default;
                                const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
                                await videoLogStore.iterate((log: any) => {
                                    if (log) {
                                        if (log.video && log.video.storageKey) {
                                            usedKeys.add(log.video.storageKey);
                                        }
                                        if (Array.isArray(log.references)) {
                                            log.references.forEach((ref: any) => {
                                                if (ref && ref.storageKey) usedKeys.add(ref.storageKey);
                                            });
                                        }
                                    }
                                });
                            } catch (e) {
                                console.error("Error iterating video_generation_logs", e);
                            }

                            // 若全站没有其他地方再引用此 storageKey，则执行真正的物理删除
                            if (!usedKeys.has(key)) {
                                if (key.startsWith("image:") || key.startsWith("server:")) {
                                    const { deleteStoredImages } = await import("@/services/image-storage");
                                    await deleteStoredImages([key]);
                                }
                                if (key.startsWith("file:") || key.startsWith("video:") || key.startsWith("server:")) {
                                    const { deleteStoredMedia } = await import("@/services/file-storage");
                                    await deleteStoredMedia([key]);
                                }
                            }
                        }, 0);
                    }

                    window.setTimeout(() => scheduleAssetSync(get), 0);
                    return { assets, deletedAssets: { ...state.deletedAssets, [id]: new Date().toISOString() } };
                }),
            hydrateAccountAssets: async (token, syncEnabled = true) => {
                if (assetHydration?.token === token) return assetHydration.request;
                const request = (async () => {
                    const scope = accountScope(token);
                    const local = assetScope === scope ? { assets: get().assets, deletedAssets: get().deletedAssets }
                        : await readAccountState<AssetSnapshot>(ASSET_STORE_KEY, scope);
                    if (useUserStore.getState().token !== token) return;
                    if (syncTimer) window.clearTimeout(syncTimer);
                    assetScope = scope;
                    activeAssetSyncToken = token;
                    accountAssetSyncEnabled = Boolean(token && syncEnabled);
                    isHydratingAccountAssets = true;
                    set({ assets: local?.assets || [], deletedAssets: local?.deletedAssets || {} });
                    try {
                        if (!token || !syncEnabled) return;
                        const remote = await fetchUserAssetData<AssetSnapshot>(token);
                        if (useUserStore.getState().token !== token) return;
                        const merged = mergeAssetSnapshots(remote, get());
                        const assets = await Promise.all(merged.assets.map(resolveStoredAsset));
                        if (useUserStore.getState().token !== token) return;
                        set(mergeAssetSnapshots({ ...merged, assets }, get()));
                    } finally {
                        if (activeAssetSyncToken === token) isHydratingAccountAssets = false;
                    }
                    await get().syncAccountAssets(token);
                })();
                assetHydration = { token, request };
                try { await request; } finally { if (assetHydration?.request === request) assetHydration = null; }
            },
            syncAccountAssets: async (token) => {
                if (!token || !accountAssetSyncEnabled || activeAssetSyncToken !== token || accountScope(token) !== assetScope) return;
                if (assetSync?.token === token) {
                    await assetSync.request;
                    return get().syncAccountAssets(token);
                }
                const snapshot = { assets: get().assets, deletedAssets: get().deletedAssets };
                const request = (async () => {
                    const prepared = await syncMediaReferences(snapshot, token);
                    if (useUserStore.getState().token !== token) return;
                    const remote = await syncUserAssetData(token, prepared);
                    if (useUserStore.getState().token !== token) return;
                    const newer = get().assets.filter((asset) => !snapshot.assets.some((old) => old.id === asset.id && old.updatedAt === asset.updatedAt));
                    set(mergeAssetSnapshots(remote, { assets: newer, deletedAssets: get().deletedAssets }));
                })();
                assetSync = { token, request };
                try { await request; } finally { if (assetSync?.request === request) assetSync = null; }
            },
            stopAccountAssetSync: () => {
                activeAssetSyncToken = "";
                accountAssetSyncEnabled = false;
                if (syncTimer) window.clearTimeout(syncTimer);
                syncTimer = null;
            },
            cleanupImages: (extra, storageKeys, ownerToken) => {
                // Other accounts and deferred guest imports share the browser's blob stores.
                if (useUserStore.getState().token) return;
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
                    const { loadLocalAgentSkills, useAgentSkillStore } = await import("@/stores/use-agent-skill-store");
                    const logKeys: string[] = [];
                    try {
                        const localforage = (await import("localforage")).default;
                        const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
                        await imageLogStore.iterate((log: any) => {
                            if (log) {
                                if (Array.isArray(log.images)) {
                                    log.images.forEach((img: any) => {
                                        if (img && img.storageKey) logKeys.push(img.storageKey);
                                    });
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                        const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
                        await videoLogStore.iterate((log: any) => {
                            if (log) {
                                if (log.video && log.video.storageKey) {
                                    logKeys.push(log.video.storageKey);
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                    } catch (e) {
                        console.error("Error gathering log keys in cleanupImages", e);
                    }

                    try {
                        await useAgentSkillStore.getState().loadSkills();
                        const skillStore = useAgentSkillStore.getState();
                        const localSkills = useUserStore.getState().token ? await loadLocalAgentSkills() : [];
                        await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, skills: [...skillStore.systemSkills, ...skillStore.userSkills, ...localSkills], extra, logKeys }, storageKeys, ownerToken);
                    } catch (error) {
                        console.error("Error gathering Skill keys in cleanupImages", error);
                    }
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra, logKeys });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets, deletedAssets: state.deletedAssets }) as StorageValue<AssetStore>["state"],
        },
    ),
);

function scheduleAssetSync(get: () => AssetStore) {
    if (isHydratingAccountAssets || !activeAssetSyncToken || !accountAssetSyncEnabled || typeof window === "undefined") return;
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
        void get().syncAccountAssets(activeAssetSyncToken).catch(reportAccountSyncFailure);
    }, 600);
}

export function mergeAssets(remoteAssets: Asset[], localAssets: Asset[]) {
    const records = new Map<string, Asset>();
    [...localAssets, ...remoteAssets].forEach((asset) => {
        const previous = records.get(asset.id);
        if (!previous || Date.parse(asset.updatedAt || "") >= Date.parse(previous.updatedAt || "")) {
            records.set(asset.id, asset);
        }
    });
    return Array.from(records.values()).sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
}
