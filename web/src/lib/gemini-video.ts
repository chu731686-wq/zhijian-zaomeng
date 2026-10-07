import { modelKey } from "@/lib/video-model-capabilities";

export function isGeminiVeo31Model(model: string) {
    const key = modelKey(model);
    return key.startsWith("veo-3-1") || key.startsWith("veo3-1");
}

export function normalizeGeminiVideoResolution(value: string) {
    const normalized = value.trim().toLowerCase().replace(/p$/, "");
    if (normalized === "4k") return "4k";
    if (["1080", "2k"].includes(normalized)) return "1080p";
    return "720p";
}

export function normalizeGeminiVideoRatio(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "auto" || normalized === "adaptive") return "";
    if (["9:16", "3:4", "2:3", "720x1280", "1080x1920"].includes(normalized)) return "9:16";
    return "16:9";
}

export function normalizeGeminiVideoDuration(value: string, forceEightSeconds = false) {
    if (forceEightSeconds) return "8";
    const seconds = Math.max(1, Math.min(30, Math.floor(Number(value) || 6)));
    if (seconds <= 5) return "4";
    if (seconds <= 7) return "6";
    return "8";
}
