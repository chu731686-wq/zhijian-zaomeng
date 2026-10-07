import { seedanceRatioOptions } from "@/lib/seedance-video";
import { modelKey } from "@/lib/video-model-capabilities";
import { channelIdForActiveModel, channelProtocolForConfig, localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";

export const klingV26ModeOptions = [
    { value: "std", title: "标准模式", desc: "(720P 无声)" },
    { value: "pro", title: "专业模式", desc: "(1080P 音频)" },
] as const;
export const klingV3ModeOptions = [
    { value: "std", title: "720P", desc: "" },
    { value: "pro", title: "1080P", desc: "" },
    { value: "4k", title: "4K", desc: "" },
] as const;
export const klingV26RatioOptions = seedanceRatioOptions.slice(0, 3);
export const klingV26DurationOptions = [5, 10] as const;
export const klingV3DurationOptions = [3, 15] as const;
export const klingV26RatioLabels: Record<string, string> = {
    "16:9": "1280x720",
    "9:16": "720x1280",
    "1:1": "960x960",
};
export const grokVideoModeOptions = [
    { value: "fun", title: "Fun" },
    { value: "normal", title: "Normal" },
    { value: "spicy", title: "Spicy" },
] as const;

export function isAPIMartKlingV26Config(config: AiConfig, modelName: string) {
    return isAPIMartKlingConfig(config, modelName, "kling-v2-6");
}

export function isAPIMartKlingV3Config(config: AiConfig, modelName: string) {
    return isAPIMartKlingConfig(config, modelName, "kling-v3");
}

export function isAPIMartKlingMotionControlConfig(config: AiConfig, modelName: string) {
    return isProviderKlingConfig(config, modelName, "kling-v2-6-motion-control", "apimart");
}

export function isKIEKlingV3Config(config: AiConfig, modelName: string) {
    return isProviderKlingConfig(config, modelName, "kling-3-0-video", "kie") || Boolean(kieKlingOmniVariant(config, modelName));
}

export function kieKlingOmniVariant(config: AiConfig, modelName: string) {
    const key = modelKey(modelName || config.model || config.videoModel);
    const variant = key.startsWith("kling-3-0-omni-") ? key.slice("kling-3-0-omni-".length) : "";
    if (!["text-to-video", "image-to-video", "reference-to-video", "transformation"].includes(variant)) return "";
    return isProviderKlingConfig(config, modelName, key, "kie") ? variant : "";
}

export function isKIEKlingMotionControlConfig(config: AiConfig, modelName: string) {
    return isProviderKlingConfig(config, modelName, "kling-2-6-motion-control", "kie") || isProviderKlingConfig(config, modelName, "kling-3-0-motion-control", "kie");
}

function isAPIMartKlingConfig(config: AiConfig, modelName: string, key: string) {
    return isProviderKlingConfig(config, modelName, key, "apimart");
}

function isProviderKlingConfig(config: AiConfig, modelName: string, key: string, provider: string) {
    const model = modelName || config.model || config.videoModel;
    if (modelKey(model) !== key) return false;
    const scopedConfig = { ...config, model, videoModel: model };
    const channelId = channelIdForActiveModel(scopedConfig);
    const channels = config.channelMode === "remote" ? config.publicChannels : [localChannelForActiveModel(scopedConfig)];
    const channel = channels.find((item) => (item?.id || "") === channelId) || channels[0];
    const record = channel as { id?: string; name?: string; baseUrl?: string; remark?: string } | undefined;
    const text = [record?.id, record?.name, record?.baseUrl, record?.remark].filter(Boolean).join(" ").toLowerCase();
    return text.includes(provider);
}

export function normalizeKlingV26Ratio(value: string) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["9:16", "720x1280", "1080x1920"].includes(normalized)) return "9:16";
    if (["1:1", "1024x1024", "1080x1080"].includes(normalized)) return "1:1";
    return "16:9";
}

export function normalizeKlingV26Duration(value: string) {
    return String(value).trim() === "10" ? 10 : 5;
}

export function normalizeKlingV3Duration(value: string) {
    const seconds = Math.floor(Number(value) || 3);
    return Math.max(3, Math.min(15, seconds));
}

export function isKIEGrokVideoModel(config: AiConfig, modelName: string) {
    const model = (modelName || "").toLowerCase().trim();
    if (model !== "grok-imagine/text-to-video" && model !== "grok-imagine/image-to-video") return false;
    return channelProtocolForConfig({ ...config, model, videoModel: model }) === "kie";
}
