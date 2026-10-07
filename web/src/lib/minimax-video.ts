import { normalizeSeedanceRatio } from "@/lib/seedance-video";
import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";

export const MINIMAX_CHANNEL_PROTOCOL = "metaso" as const;
export const miniMaxModels = ["MiniMax-H3"] as const;

export function isMiniMaxChannel(channel?: { protocol?: string }) {
    return channel?.protocol === MINIMAX_CHANNEL_PROTOCOL;
}

export function isMiniMaxH3Config(config: AiConfig, modelName: string) {
    const model = modelName.trim();
    return model.toLowerCase() === "minimax-h3"
        && channelProtocolForConfig({ ...config, model, videoModel: model }) === MINIMAX_CHANNEL_PROTOCOL;
}

export function normalizeMiniMaxH3Resolution(value: string) {
    const resolution = value.trim().toLowerCase().replace(/p$/, "");
    return ["1080", "2k", "4k"].includes(resolution) ? "2K" : "768P";
}

export function normalizeMiniMaxH3Duration(value: string) {
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(4, Math.min(15, seconds));
}

export function normalizeMiniMaxH3Ratio(value: string) {
    return normalizeSeedanceRatio(value);
}
