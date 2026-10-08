import { localForageStorage } from "@/lib/localforage-storage";
import { useUserStore } from "@/stores/use-user-store";
import { accountScope } from "./account-storage";

export type SyncedMedia = { storageKey: string; url: string; bytes: number; mimeType: string };
const uploads = new Map<string, Promise<SyncedMedia>>();

class ExternalMediaDownloadError extends Error {
    constructor(readonly source: string) {
        super("外链素材下载失败");
        this.name = "ExternalMediaDownloadError";
    }
}

function assertSession(token: string) {
    if (!token || useUserStore.getState().token !== token) throw new Error("登录状态已变化，请重新同步");
}

async function syncMedia(source: string, token: string, kind = "image", team = false): Promise<SyncedMedia> {
    assertSession(token);
    const cacheKey = `infinite-canvas:uploaded:${team ? "team:" : ""}${accountScope(token)}:${source}`;
    const existing = uploads.get(cacheKey);
    if (existing) return existing;
    const request = (async () => {
        // Local storage keys are stable; blob URLs are only valid for this browser session.
        if (!source.startsWith("blob:") && !source.startsWith("data:")) {
            const cached = await localForageStorage.getItem(cacheKey);
            if (cached) return JSON.parse(cached) as SyncedMedia;
        }
        const images = await import("./image-storage");
        const media = await import("./file-storage");
        let blob = await images.getImageBlob(source);
        if (!blob) blob = await media.getMediaBlob(source);
        assertSession(token);
        if (!blob) {
            if (!/^(blob:|data:|https?:\/\/)/.test(source)) throw new Error("本机素材文件缺失，请重新上传");
            let response: Response;
            try {
                response = await fetch(images.getProxyUrl(source));
            } catch (error) {
                assertSession(token);
                if (/^https?:\/\//.test(source)) throw new ExternalMediaDownloadError(source);
                throw error;
            }
            if (!response.ok) {
                if (/^https?:\/\//.test(source)) throw new ExternalMediaDownloadError(source);
                throw new Error("素材下载失败");
            }
            blob = await response.blob();
        }
        assertSession(token);
        const uploaded = team ? await media.uploadTeamCanvasFile(blob, token) : blob.type.startsWith("image/") || (kind === "image" && !blob.type.startsWith("video/") && !blob.type.startsWith("audio/"))
            ? await images.uploadImage(blob, { token })
            : await media.uploadMediaBlob(blob, `media.${blob.type.split("/")[1]?.split(";")[0] || "bin"}`);
        assertSession(token);
        if (!uploaded.storageKey.startsWith("server:")) throw new Error("媒体未保存到服务器，请重试");
        if (!source.startsWith("blob:") && !source.startsWith("data:")) await localForageStorage.setItem(cacheKey, JSON.stringify(uploaded));
        return uploaded;
    })().catch((error) => { uploads.delete(cacheKey); throw error; });
    uploads.set(cacheKey, request);
    return request;
}

// Walk structured data; never replace substrings in user text or JSON strings.
export async function syncMediaReferences<T>(input: T, token: string, team = false): Promise<T> {
    const replacements = new Map<string, string>();
    const failedExternalUrls = new Set<string>();
    async function syncSource(source: string, kind = "image"): Promise<SyncedMedia | null> {
        if (failedExternalUrls.has(source)) return null;
        try {
            return await syncMedia(source, token, kind, team);
        } catch (error) {
            if (team || !(error instanceof ExternalMediaDownloadError)) throw error;
            if (!failedExternalUrls.has(source)) {
                failedExternalUrls.add(source);
                let hostname = "未知域名";
                try { hostname = new URL(source).hostname || hostname; } catch { /* Keep the warning free of the full URL. */ }
                console.warn(`外链素材已失效，保留原链接：${hostname}`);
            }
            return null;
        }
    }
    async function visit(value: unknown, inheritedKind = "", field = ""): Promise<unknown> {
        assertSession(token);
        if (Array.isArray(value)) {
            const result = [];
            for (const item of value) result.push(await visit(item, inheritedKind, field));
            return result;
        }
        if (typeof value === "string") {
            if (!["references", "url", "dataUrl", "imageUrl", "coverUrl", "content"].includes(field) || (field === "content" && inheritedKind === "text")) return value;
            if (replacements.has(value)) return replacements.get(value);
            if (field === "references" && /^(image:|file:|video:|audio:|asset-image:|asset-media:|asset-video:|asset-audio:|workflow-video:|workflow-audio:|blob:|data:|https?:\/\/)/.test(value)) {
                const uploaded = await syncSource(value, inheritedKind || "image");
                if (!uploaded) return value;
                const result = /^(blob:|data:|https?:\/\/)/.test(value) ? uploaded.url : uploaded.storageKey;
                replacements.set(value, result);
                return result;
            }
            return value;
        }
        if (!value || typeof value !== "object") return value;
        const record = value as Record<string, unknown>;
        const kind = String(record.kind || record.type || inheritedKind);
        const result: Record<string, unknown> = { ...record };
        const key = typeof record.storageKey === "string" ? record.storageKey : "";
        let uploaded: SyncedMedia | null = null;
        if (key && (!key.startsWith("server:") || team && key.startsWith("server:webdav:"))) uploaded = await syncSource(key, kind);
        const mediaKind = typeof record.dataUrl === "string" || typeof record.imageUrl === "string" || ["image", "image_url", "panorama", "video", "audio"].includes(kind) || typeof record.mimeType === "string" && /^(image|video|audio)\//.test(record.mimeType);
        if (!key && mediaKind) {
            const source = [record.content, record.dataUrl, record.url, record.imageUrl].find((item) => typeof item === "string" && /^(data:|blob:|https?:\/\/)/.test(item));
            if (typeof source === "string") uploaded = await syncSource(source, kind === "panorama" || kind === "image_url" ? "image" : kind);
        }
        if (uploaded) {
            result.storageKey = uploaded.storageKey;
            result.bytes = uploaded.bytes;
            result.mimeType = uploaded.mimeType;
            if (key) replacements.set(key, uploaded.storageKey);
            for (const field of ["url", "dataUrl", "imageUrl", "content", "coverUrl"]) {
                if (typeof record[field] === "string" && /^(blob:|data:|https?:\/\/|\/api\/files\/)/.test(record[field] as string)) {
                    replacements.set(record[field] as string, uploaded.url);
                    result[field] = uploaded.url;
                }
            }
        } else if (key.startsWith("server:") && !key.startsWith("server:webdav:")) {
            const url = `/api/files/${encodeURIComponent(key.slice(7))}/content`;
            for (const field of ["url", "dataUrl", "imageUrl", "content", "coverUrl"]) {
                if (typeof record[field] === "string" && (/^(blob:|data:)/.test(record[field]) || team && /^(https?:\/\/|\/api\/files\/)/.test(record[field]))) result[field] = url;
            }
        }
        for (const [field, item] of Object.entries(result).sort(([a], [b]) => Number(["data", "metadata"].includes(b)) - Number(["data", "metadata"].includes(a)))) {
            if (field === "storageKey") continue;
            if (field === "coverUrl" && typeof item === "string" && /^(blob:|data:)/.test(item)) {
                const uploadedCover = replacements.get(item) || (await syncSource(item))?.url;
                if (uploadedCover) result[field] = uploadedCover;
            } else {
                result[field] = await visit(item, kind, field);
            }
        }
        return result;
    }
    return await visit(input) as T;
}
