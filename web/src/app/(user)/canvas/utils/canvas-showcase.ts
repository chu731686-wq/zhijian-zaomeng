import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData } from "../types";
import { buildGenerationReferences, type GenerationReference } from "./canvas-generation-references";

export type CanvasToolRecord = { id: string; name: string; arguments: Record<string, unknown>; result?: unknown };
export type CanvasRecordedSession = CanvasAssistantSession & { toolHistory?: CanvasToolRecord[] };

export function showcaseToolHistory(session: CanvasRecordedSession): CanvasToolRecord[] {
    const records = new Map<string, CanvasToolRecord>();
    for (const message of session.protocolMessages || []) {
        if (message.role === "assistant") for (const call of message.toolCalls || []) records.set(call.id, call);
        if (message.role === "tool") {
            const record = records.get(message.toolCallId);
            if (record) records.set(record.id, { ...record, result: message.content });
        }
    }
    for (const record of session.toolHistory || []) records.set(record.id, record);
    return Array.from(records.values());
}

// Server storage keys are stable across browsers; local blob URLs are not.
export function showcaseMedia<T>(value: T): T {
    if (Array.isArray(value)) return value.map(showcaseMedia) as T;
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(record).map(([key, item]) => [key, showcaseMedia(item)]));
    if (typeof record.storageKey === "string" && record.storageKey.startsWith("server:") && !record.storageKey.startsWith("server:webdav:")) {
        const url = `/api/files/${encodeURIComponent(record.storageKey.slice(7))}/content`;
        for (const field of ["content", "url", "dataUrl", "imageUrl", "previewUrl"]) {
            if (typeof result[field] === "string") result[field] = url;
        }
    }
    return result as T;
}

export function showcaseReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): GenerationReference[] {
    const references = buildGenerationReferences(node, nodes, connections);
    const metadata = node.metadata || {};
    const ids = [metadata.firstFrameNodeId, metadata.lastFrameNodeId, ...(metadata.klingImageNodeIds || []), ...(metadata.klingElementList || []).flatMap((item) => item.nodeIds || [])];
    const stored = [...ids.flatMap((id) => nodes.find((item) => item.id === id)?.metadata?.content || []), ...(metadata.references || [])];
    stored.forEach((source, index) => {
        const url = source.startsWith("server:") ? `/api/files/${encodeURIComponent(source.slice(7))}/content` : source;
        if (references.some((item) => item.url === url || item.storageKey === source)) return;
        const original = nodes.find((item) => item.metadata?.content === url || item.metadata?.storageKey === source);
        const kind = original?.type === CanvasNodeType.Video ? "video" : original?.type === CanvasNodeType.Audio ? "audio" : "image";
        references.push({ id: original?.id || `saved-reference-${index}`, nodeId: original?.id || `saved-reference-${index}`, kind, createdAt: index, title: original?.title || `生成参考 ${index + 1}`, label: `参考 ${references.length + 1}`, url, previewUrl: url, active: true, mimeType: original?.metadata?.mimeType || `${kind}/*`, storageKey: original?.metadata?.storageKey });
    });
    return references;
}

export function showcaseSettingValue(key: string, value: unknown): string {
    const text = String(value);
    const labels: Record<string, Record<string, string>> = {
        size: { auto: "自动" },
        quality: { low: "低", medium: "中", high: "高" },
        vquality: { low: "低", medium: "中", high: "高" },
        generationType: { generation: "文生图", edit: "参考图生成" },
        generationMode: { image: "图片生成", video: "视频生成", audio: "音频生成", text: "文本生成" },
        mode: {
            normal: "标准", fun: "趣味", spicy: "刺激",
            std: "标准", pro: "专业", "4k": "4K", "text-to-video": "文生视频", "image-to-video": "图生视频",
        },
        characterOrientation: { image: "图片", video: "视频" },
        shotType: { intelligence: "智能分镜", customize: "自定义" },
        multiShot: { true: "是", false: "否" },
        generateAudio: { true: "是", false: "否" },
        watermark: { true: "是", false: "否" },
    };
    return labels[key]?.[text] || text;
}
