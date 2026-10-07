import { saveAs } from "file-saver";
import { message } from "antd";
import { nanoid } from "nanoid";

import { createZip } from "@/lib/zip";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasExportAsset, CanvasExportFile } from "../export-types";
import type { CanvasProject } from "../stores/use-canvas-store";

const mediaFields = ["references", "url", "dataUrl", "imageUrl", "coverUrl", "content"];

export async function exportCanvasProjects(projects: CanvasProject[], fileName = "无限画布") {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const token = useUserStore.getState().token;
    const missingKeys = new Set<string>();
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            await Promise.all(
                collectStorageKeys(project).map(async (storageKey) => {
                    let blob: Blob | null;
                    try {
                        if (storageKey.startsWith("server:")) {
                            const response = await fetch(serverContentUrl(storageKey), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                            if (!response.ok) throw new Error("素材下载失败");
                            blob = await response.blob();
                            if (blob.type.includes("json") || blob.type.startsWith("text/")) throw new Error("素材下载失败");
                        } else {
                            blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                        }
                        if (!blob) throw new Error("本机素材缺失");
                    } catch {
                        missingKeys.add(storageKey);
                        return;
                    }
                    const path = `projects/${project.id}/files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
                    files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }),
            );
            return { project, files };
        }),
    );

    const data: CanvasExportFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
    if (missingKeys.size) void message.warning(`有 ${missingKeys.size} 个素材未能导出`);
}

export async function restoreCanvasProject(project: CanvasProject, files: CanvasExportAsset[], zip: Map<string, Blob>): Promise<CanvasProject> {
    const replacements = new Map<string, { storageKey: string; url: string }>();
    await Promise.all(files.map(async (item) => {
        const blob = zip.get(item.path);
        if (!blob) return;
        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
        const isImage = item.storageKey.startsWith("image:") || (item.storageKey.startsWith("server:") && typedBlob.type.startsWith("image/"));
        const storageKey = item.storageKey.startsWith("server:") ? `${isImage ? "image" : "file"}:${nanoid()}` : item.storageKey;
        const url = await (isImage ? setImageBlob(storageKey, typedBlob) : setMediaBlob(storageKey, typedBlob));
        const replacement = { storageKey, url };
        replacements.set(item.storageKey, replacement);
        if (item.storageKey.startsWith("server:")) replacements.set(serverContentUrl(item.storageKey), replacement);
    }));

    // Replace media fields in structured data, never substrings in prompts or JSON strings.
    function visit(value: unknown, inheritedKind = "", field = ""): unknown {
        if (Array.isArray(value)) return value.map((item) => visit(item, inheritedKind, field));
        if (typeof value === "string") {
            if (field !== "storageKey" && !mediaFields.includes(field) || field === "content" && inheritedKind === "text") return value;
            const replacement = replacements.get(value);
            if (!replacement) return value;
            return field === "storageKey" || field === "references" && value.includes(":") && !value.startsWith("/api/") ? replacement.storageKey : replacement.url;
        }
        if (!value || typeof value !== "object") return value;
        const record = value as Record<string, unknown>;
        const kind = String(record.kind || record.type || inheritedKind);
        const replacement = typeof record.storageKey === "string" ? replacements.get(record.storageKey) : undefined;
        return Object.fromEntries(Object.entries(record).map(([field, item]) => {
            if (replacement && mediaFields.includes(field) && field !== "references" && !(field === "content" && kind === "text") && typeof item === "string" && /^(blob:|data:|https?:\/\/|\/api\/files\/)/.test(item)) return [field, replacement.url];
            return [field, visit(item, kind, field)];
        }));
    }
    return visit(project) as CanvasProject;
}

function collectStorageKeys(value: unknown, keys = new Set<string>(), inheritedKind = "", field = ""): string[] {
    if (Array.isArray(value)) value.forEach((item) => collectStorageKeys(item, keys, inheritedKind, field));
    else if (typeof value === "string") {
        if (field === "storageKey" && value.includes(":") || field === "references" && /^(server:|image:|file:|video:|audio:|asset-image:|asset-media:|asset-video:|asset-audio:|workflow-video:|workflow-audio:)/.test(value)) keys.add(value);
        else if (mediaFields.includes(field) && !(field === "content" && inheritedKind === "text")) {
            const match = value.match(/^\/api\/files\/([^/]+)\/content$/);
            if (match) keys.add(`server:${decodeURIComponent(match[1])}`);
        }
    } else if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const kind = String(record.kind || record.type || inheritedKind);
        Object.entries(record).forEach(([field, item]) => collectStorageKeys(item, keys, kind, field));
    }
    return [...keys];
}

function serverContentUrl(storageKey: string) {
    return `/api/files/${encodeURIComponent(storageKey.slice("server:".length))}/content`;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return storageKey.startsWith("image:") ? "png" : "bin";
}
