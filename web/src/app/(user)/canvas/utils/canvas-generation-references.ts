import { chineseNumber } from "@/lib/chinese-number";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasPendingMaterial } from "../types";
import { isCanvasImageNodeType } from "./canvas-panorama";
import type { CanvasResourceReference } from "./canvas-resource-references";

export type GenerationReference = CanvasResourceReference & Omit<CanvasPendingMaterial, "kind"> & {
    kind: CanvasPendingMaterial["kind"];
    connectionId?: string;
    targetNodeId?: string;
};

export const materialTokenPattern = /@\[material:([^\]]+)\]/g;
export const materialToken = (id: string) => `@[material:${encodeURIComponent(id)}]`;
export function materialId(tokenId: string) {
    try { return decodeURIComponent(tokenId); } catch { return tokenId; }
}

export function buildGenerationReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): GenerationReference[] {
    const uploaded: GenerationReference[] = (node.metadata?.pendingMaterials || []).map((material) => ({ ...material, nodeId: material.id, label: "", previewUrl: material.url, active: true }));
    const connected = connections.flatMap((connection, index): GenerationReference[] => {
        if (connection.toNodeId !== node.id) return [];
        const source = nodes.find((item) => item.id === connection.fromNodeId);
        if (!source?.metadata?.content) return [];
        const kind = isCanvasImageNodeType(source.type) ? "image" : source.type === CanvasNodeType.Video ? "video" : source.type === CanvasNodeType.Audio ? "audio" : null;
        if (!kind) return [];
        return [{ id: source.id, nodeId: source.id, kind, createdAt: connection.createdAt ?? index - connections.length, title: source.title, label: "", url: source.metadata.content, previewUrl: source.metadata.content, active: true, connectionId: connection.id, targetNodeId: node.id, storageKey: source.metadata.storageKey, mimeType: source.metadata.mimeType || (kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg"), bytes: source.metadata.bytes, width: source.metadata.naturalWidth, height: source.metadata.naturalHeight, durationMs: source.metadata.durationMs }];
    });
    const counts = { image: 0, video: 0, audio: 0 };
    return [...connected, ...uploaded].sort((a, b) => a.createdAt - b.createdAt).map((reference) => ({ ...reference, label: `${reference.kind === "image" ? "图片" : reference.kind === "video" ? "视频" : "音频"}${chineseNumber(++counts[reference.kind])}` }));
}

export function resolveMaterialPrompt(prompt: string, references: GenerationReference[]) {
    const byId = new Map(references.map((reference) => [reference.id, reference.label]));
    return prompt.replace(materialTokenPattern, (_, id: string) => byId.get(materialId(id)) || "");
}

export function removeMissingMaterialTokens(prompt: string, references: GenerationReference[]) {
    const ids = new Set(references.map((reference) => reference.id));
    return prompt.replace(materialTokenPattern, (token, id: string) => ids.has(materialId(id)) ? token : "");
}

// 旧编辑器把数字编号直接存成文本；首次打开时转为稳定 ID，之后只解析显式标签。
export function migrateMaterialPrompt(prompt: string, references: GenerationReference[]) {
    const counts = { image: 0, video: 0, audio: 0 };
    const legacy = new Map(references.filter((reference) => reference.connectionId).map((reference) => [`${reference.kind === "image" ? "图片" : reference.kind === "video" ? "视频" : "音频"}${++counts[reference.kind]}`, reference.id]));
    return prompt.replace(/@?(图片|视频|音频)\d+/g, (label) => {
        const id = legacy.get(label.replace(/^@/, ""));
        return id ? materialToken(id) : label;
    });
}
