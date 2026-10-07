"use client";

import { nanoid } from "nanoid";

import type { UserWebDAVStorageProvider } from "@/services/image-storage";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const DIRECT_STORAGE_KEY_PREFIX = "server:webdav:";
const directCapabilities = new Map<string, "supported" | "unavailable">();
const rangeCapabilities = new Map<string, "supported" | "unavailable">();
const ensuredDirectories = new Set<string>();
const mediaConfigs = new Map<string, { endpoint: string; authorization: string }>();
const mediaConfigIds = new Map<string, string>();
let serviceWorkerPromise: Promise<ServiceWorkerRegistration> | null = null;
let serviceWorkerMessagesReady = false;

export class WebDAVDirectUnavailableError extends Error {
    constructor(message = "当前 WebDAV 不允许浏览器直连") {
        super(message);
        this.name = "WebDAVDirectUnavailableError";
    }
}

export class WebDAVRangeUnavailableError extends Error {
    constructor(message = "当前 WebDAV 不支持浏览器分段读取") {
        super(message);
        this.name = "WebDAVRangeUnavailableError";
    }
}

export function isWebDAVDirectUnavailable(error: unknown) {
    return error instanceof WebDAVDirectUnavailableError || error instanceof WebDAVRangeUnavailableError;
}

export function isDirectWebDAVStorageKey(storageKey?: string) {
    return Boolean(storageKey?.startsWith(DIRECT_STORAGE_KEY_PREFIX));
}

export function directWebDAVStorageKey(objectKey: string) {
    return DIRECT_STORAGE_KEY_PREFIX + encodeURIComponent(objectKey);
}

export function directWebDAVObjectKey(storageKey: string) {
    return decodeURIComponent(storageKey.slice(DIRECT_STORAGE_KEY_PREFIX.length));
}

export function createDirectWebDAVObjectKey(provider: UserWebDAVStorageProvider, filename: string, owner: string) {
    const date = new Date().toISOString().slice(0, 10).split("-");
    const extension = filename.match(/\.[a-z0-9]{1,10}$/i)?.[0].toLowerCase() || "";
    return [provider.pathPrefix.replace(/^\/+|\/+$/g, "") || "canvas", owner, ...date, nanoid() + extension].join("/");
}

export async function persistDirectWebDAV(provider: UserWebDAVStorageProvider, blob: Blob, filename: string) {
    const { token, user } = useUserStore.getState();
    if (blob.type === "video/mp4" && !filename.endsWith(".mp4")) filename += ".mp4";
    const objectKey = createDirectWebDAVObjectKey(provider, filename, token && user ? user.id : "anonymous");
    try {
        await uploadDirectWebDAV(provider, objectKey, blob);
        if (!token) {
            return { url: "", storageKey: directWebDAVStorageKey(objectKey), bytes: blob.size, mimeType: blob.type || "application/octet-stream" };
        }
        try {
            const { registerDirectStorageObject } = await import("@/services/api/storage");
            return await registerDirectStorageObject(token, { provider, objectKey, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
        } catch (error) {
            await deleteDirectWebDAV(provider, objectKey).catch(() => undefined);
            throw error;
        }
    } catch (error) {
        if (token && isWebDAVDirectUnavailable(error)) {
            if (!useConfigStore.getState().config.syncWebDAVStorageConfig) {
                throw new WebDAVDirectUnavailableError("当前 WebDAV 不允许浏览器直连，请先开启 WebDAV 自动同步");
            }
            return null;
        }
        throw error;
    }
}

export async function deletePersistedDirectWebDAV(provider: UserWebDAVStorageProvider, storageKey: string) {
    if (isDirectWebDAVStorageKey(storageKey)) {
        await deleteDirectWebDAV(provider, directWebDAVObjectKey(storageKey));
        return true;
    }
    const token = useUserStore.getState().token;
    if (!token || !storageKey.startsWith("server:")) return false;
    const id = storageKey.slice("server:".length);
    const { deleteDirectStorageObjectRecord, getStorageObjectInfo } = await import("@/services/api/storage");
    const info = await getStorageObjectInfo(id).catch(() => null);
    if (!info?.direct) return false;
    try {
        await deleteDirectWebDAV(provider, info.objectKey);
        await deleteDirectStorageObjectRecord(token, id);
        return true;
    } catch (error) {
        if (isWebDAVDirectUnavailable(error)) return false;
        throw error;
    }
}

async function uploadDirectWebDAV(provider: UserWebDAVStorageProvider, objectKey: string, blob: Blob) {
    const directory = objectKey.slice(0, objectKey.lastIndexOf("/"));
    if (directory) await ensureDirectWebDAVDirectory(provider, directory);
    const response = await directWebDAVFetch(provider, objectKey, {
        method: "PUT",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
    });
    if (!response.ok) {
        await response.body?.cancel();
        throw webDAVResponseError(response, "WebDAV 上传失败");
    }
    await response.body?.cancel();
}

export async function deleteDirectWebDAV(provider: UserWebDAVStorageProvider, objectKey: string) {
    const response = await directWebDAVFetch(provider, objectKey, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
        await response.body?.cancel();
        throw webDAVResponseError(response, "WebDAV 删除失败");
    }
    await response.body?.cancel();
}

export async function readDirectWebDAV(provider: UserWebDAVStorageProvider, objectKey: string, mimeType = "application/octet-stream") {
    const response = await directWebDAVFetch(provider, objectKey, { method: "GET" });
    if (!response.ok) {
        await response.body?.cancel();
        throw webDAVResponseError(response, "WebDAV 读取失败");
    }
    return new Blob([await response.arrayBuffer()], { type: mimeType });
}

export async function directWebDAVMediaUrl(provider: UserWebDAVStorageProvider, objectKey: string) {
    await ensureRangeSupport(provider, objectKey);
    const registration = await ensureMediaServiceWorker();
    const key = providerKey(provider);
    let configId = mediaConfigIds.get(key);
    if (!configId) {
        configId = nanoid();
        mediaConfigIds.set(key, configId);
    }
    const config = { endpoint: provider.endpoint.replace(/\/+$/, ""), authorization: basicAuthorization(provider.username, provider.password) };
    mediaConfigs.set(configId, config);
    registration.active?.postMessage({ type: "webdav-media-config", id: configId, config });
    return `/webdav-media/${encodeURIComponent(configId)}/${encodeURIComponent(objectKey)}`;
}

async function directWebDAVFetch(provider: UserWebDAVStorageProvider, objectKey: string, init: RequestInit) {
    const key = providerKey(provider);
    if (directCapabilities.get(key) === "unavailable") throw new WebDAVDirectUnavailableError();
    const headers = new Headers(init.headers);
    if (provider.username || provider.password) headers.set("Authorization", basicAuthorization(provider.username, provider.password));
    try {
        const response = await fetch(remoteURL(provider, objectKey), { ...init, headers });
        directCapabilities.set(key, "supported");
        return response;
    } catch (cause) {
        directCapabilities.set(key, "unavailable");
        throw Object.assign(new WebDAVDirectUnavailableError(), { cause });
    }
}

async function ensureDirectWebDAVDirectory(provider: UserWebDAVStorageProvider, directory: string) {
    const parts = directory.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const cacheKey = `${providerKey(provider)}\n${current}`;
        if (ensuredDirectories.has(cacheKey)) continue;
        const response = await directWebDAVFetch(provider, current, { method: "MKCOL" });
        if (!response.ok && !((response.status === 405 || response.status === 423) && (await directWebDAVDirectoryExists(provider, current)))) {
            await response.body?.cancel();
            throw webDAVResponseError(response, "WebDAV 创建目录失败");
        }
        await response.body?.cancel();
        ensuredDirectories.add(cacheKey);
    }
}

async function directWebDAVDirectoryExists(provider: UserWebDAVStorageProvider, directory: string) {
    const response = await directWebDAVFetch(provider, directory, { method: "PROPFIND", headers: { Depth: "0" } });
    const exists = response.ok || response.status === 207;
    await response.body?.cancel();
    return exists;
}

function webDAVResponseError(response: Response, message: string) {
    const detail =
        response.status === 401
            ? "认证失败"
            : response.status === 403
              ? "没有操作权限"
              : response.status === 404
                ? "文件或目录不存在"
                : response.status === 405
                  ? "当前操作不受支持"
                  : `HTTP ${response.status}`;
    return Object.assign(new Error(`${message}：${detail}`), { status: response.status });
}

async function ensureRangeSupport(provider: UserWebDAVStorageProvider, objectKey: string) {
    const key = providerKey(provider);
    const cached = rangeCapabilities.get(key);
    if (cached === "supported") return;
    if (cached === "unavailable") throw new WebDAVRangeUnavailableError();
    if (directCapabilities.get(key) === "unavailable") throw new WebDAVDirectUnavailableError();
    let response: Response;
    try {
        response = await fetch(remoteURL(provider, objectKey), {
            headers: { Authorization: basicAuthorization(provider.username, provider.password), Range: "bytes=0-0" },
            cache: "no-store",
        });
    } catch {
        directCapabilities.set(key, "unavailable");
        throw new WebDAVDirectUnavailableError();
    }
    if (response.status === 206 && response.headers.get("content-range")) {
        directCapabilities.set(key, "supported");
        rangeCapabilities.set(key, "supported");
        await response.body?.cancel();
        return;
    }
    await response.body?.cancel();
    if (response.ok) {
        directCapabilities.set(key, "supported");
        rangeCapabilities.set(key, "unavailable");
        throw new WebDAVRangeUnavailableError();
    }
    directCapabilities.set(key, "supported");
    throw Object.assign(new Error(`WebDAV 读取失败：${response.status}`), { status: response.status });
}

async function ensureMediaServiceWorker() {
    if (!("serviceWorker" in navigator)) throw new WebDAVRangeUnavailableError("当前浏览器不支持 WebDAV 分段读取");
    if (!serviceWorkerMessagesReady) {
        navigator.serviceWorker.addEventListener("message", (event) => {
            if (event.data?.type !== "webdav-media-config-request") return;
            const config = mediaConfigs.get(String(event.data.id || ""));
            if (config) (event.source as ServiceWorker | null)?.postMessage({ type: "webdav-media-config", id: event.data.id, config });
        });
        serviceWorkerMessagesReady = true;
    }
    serviceWorkerPromise ||= navigator.serviceWorker.register("/webdav-media-sw.js", { scope: "/" }).then(async (registration) => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
            await new Promise<void>((resolve) => {
                const timeout = window.setTimeout(resolve, 3000);
                navigator.serviceWorker.addEventListener("controllerchange", () => {
                    window.clearTimeout(timeout);
                    resolve();
                }, { once: true });
            });
        }
        if (!navigator.serviceWorker.controller) throw new WebDAVRangeUnavailableError("WebDAV 分段读取服务未就绪");
        return registration;
    });
    return serviceWorkerPromise;
}

function providerKey(provider: UserWebDAVStorageProvider) {
    return [provider.endpoint, provider.pathPrefix, provider.username, provider.password].join("\n");
}

function remoteURL(provider: UserWebDAVStorageProvider, objectKey: string) {
    return provider.endpoint.replace(/\/+$/, "") + "/" + objectKey.split("/").map(encodeURIComponent).join("/");
}

function basicAuthorization(username: string, password: string) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let value = "";
    bytes.forEach((byte) => { value += String.fromCharCode(byte); });
    return `Basic ${btoa(value)}`;
}
