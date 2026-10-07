import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";

const grokTtsModels = new Set([
    "grok-voice-latest",
    "grok-voice-think-fast-2.0",
    "grok-voice-think-fast-1.0",
]);

export const grokTtsLanguageOptions = [
    { value: "auto", label: "自动识别" },
    { value: "en", label: "英语" },
    { value: "zh", label: "中文" },
    { value: "ja", label: "日语" },
    { value: "ko", label: "韩语" },
    { value: "fr", label: "法语" },
    { value: "de", label: "德语" },
    { value: "hi", label: "印地语" },
    { value: "id", label: "印度尼西亚语" },
    { value: "it", label: "意大利语" },
    { value: "ru", label: "俄语" },
    { value: "tr", label: "土耳其语" },
    { value: "vi", label: "越南语" },
    { value: "bn", label: "孟加拉语" },
    { value: "pt-BR", label: "葡萄牙语（巴西）" },
    { value: "pt-PT", label: "葡萄牙语（葡萄牙）" },
    { value: "es-MX", label: "西班牙语（墨西哥）" },
    { value: "es-ES", label: "西班牙语（西班牙）" },
    { value: "ar-EG", label: "阿拉伯语（埃及）" },
    { value: "ar-SA", label: "阿拉伯语（沙特）" },
    { value: "ar-AE", label: "阿拉伯语（阿联酋）" },
];

export const grokTtsFormatOptions = [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
];

export type GrokTtsVoice = {
    voice_id: string;
    name?: string;
    language?: string | null;
};

export function isGrokTtsModel(model: string) {
    const name = model.trim().toLowerCase().split("/").pop() || "";
    return grokTtsModels.has(name);
}

export function isGrok2APITtsConfig(config: AiConfig, model: string) {
    return isGrokTtsModel(model) && channelProtocolForConfig({ ...config, model, audioModel: model }) === "grok2api";
}

export function normalizeGrokTtsLanguage(value: string) {
    return grokTtsLanguageOptions.some((item) => item.value === value) ? value : "auto";
}

export function normalizeGrokTtsFormat(value: string) {
    return grokTtsFormatOptions.some((item) => item.value === value) ? value : "mp3";
}

export function normalizeGrokTtsSpeed(value: string) {
    const speed = Number(value);
    if (!Number.isFinite(speed)) return "1";
    return String(Math.max(0.7, Math.min(1.5, Number(speed.toFixed(2)))));
}
