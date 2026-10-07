export const MIMO_PROTOCOL = "mimo" as const;

export const mimoTextModels = ["mimo-v2.5", "mimo-v2.5-pro"] as const;

export const mimoTtsModels = ["mimo-v2.5-tts", "mimo-v2.5-tts-voicedesign", "mimo-v2.5-tts-voiceclone"] as const;

export const mimoModels = [...mimoTextModels, ...mimoTtsModels] as const;

export const mimoTtsVoiceOptions = [
    { value: "冰糖", label: "冰糖" },
    { value: "茉莉", label: "茉莉" },
    { value: "苏打", label: "苏打" },
    { value: "白桦", label: "白桦" },
    { value: "Mia", label: "Mia" },
    { value: "Chloe", label: "Chloe" },
    { value: "Milo", label: "Milo" },
    { value: "Dean", label: "Dean" },
] as const;

// 当前项目使用非流式生成，仅开放官方支持的封装音频格式。
export const mimoTtsFormatOptions = [
    { value: "wav", label: "WAV" },
    { value: "mp3", label: "MP3" },
] as const;

export function isMimoTtsModel(model: string) {
    return mimoTtsModels.includes(model.trim().toLowerCase() as (typeof mimoTtsModels)[number]);
}

export function isMimoPresetTtsModel(model: string) {
    return model.trim().toLowerCase() === "mimo-v2.5-tts";
}

export function isMimoVoiceDesignModel(model: string) {
    return model.trim().toLowerCase() === "mimo-v2.5-tts-voicedesign";
}

export function isMimoVoiceCloneModel(model: string) {
    return model.trim().toLowerCase() === "mimo-v2.5-tts-voiceclone";
}

export function isMimoChannel(channel?: { protocol?: string; baseUrl?: string } | null) {
    const protocol = channel?.protocol?.trim().toLowerCase() || "";
    const baseUrl = channel?.baseUrl?.trim().toLowerCase() || "";
    return protocol === MIMO_PROTOCOL || baseUrl.includes("xiaomimimo.com");
}

export function normalizeMimoTtsVoice(value: string) {
    return mimoTtsVoiceOptions.some((item) => item.value === value) ? value : "冰糖";
}

export function normalizeMimoTtsFormat(value: string) {
    return mimoTtsFormatOptions.some((item) => item.value === value) ? value : "wav";
}

export function mimoTtsVoiceLabel(value: string) {
    const voice = normalizeMimoTtsVoice(value);
    return mimoTtsVoiceOptions.find((item) => item.value === voice)?.label || voice;
}
