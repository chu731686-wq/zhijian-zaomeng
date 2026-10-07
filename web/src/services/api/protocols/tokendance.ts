import { tokenDanceAppUrl } from "@/lib/model-channel";
import { collectHTTPURLs, firstString, normalizeDirectStatus, readDirectError, readNumber, readPath, readString, uniqueHTTPURLs } from "./shared";
import type { DirectProtocolAdapter } from "./types";

const TASK_SEPARATOR = "::";

export function tokenDanceTaskID(protocol: string | undefined, taskId: string) {
    return protocol ? `${protocol}${TASK_SEPARATOR}${taskId}` : taskId;
}

function splitTaskID(value: string) {
    const index = value.indexOf(TASK_SEPARATOR);
    return index < 0
        ? { protocol: "", taskId: value }
        : { protocol: value.slice(0, index), taskId: value.slice(index + TASK_SEPARATOR.length) };
}

function gatewayURL(baseUrl: string, path: string) {
    let base = baseUrl.trim().replace(/\/+$/, "");
    if (/\/v1$/i.test(base)) base = base.slice(0, -3).replace(/\/+$/, "");
    return `${base}${path}`;
}

function pollPath(protocol: string, taskId: string) {
    const id = encodeURIComponent(taskId);
    switch (protocol) {
        case "seedance:generations": return `/ark/v3/generations/tasks/${id}`;
        case "kling:text2video": return `/kling/v1/text2video/${id}`;
        case "kling:image2video": return `/kling/v1/image2video/${id}`;
        case "kling:motion-control": return `/kling/v1/motion-control/${id}`;
        case "kling:omni-video": return `/kling/v1/omni-video/${id}`;
        case "wan3:video-synthesis": return `/alibaba/wan3/v1/tasks/${id}`;
        case "happyhorse:video-synthesis": return `/alibaba/happyhorse/v1/tasks/${id}`;
        case "minimax:video_generation_v2": return `/minimax/v2/query/video_generation/${id}`;
        default: throw new Error(`不支持的 TokenDance 轮询协议：${protocol || "unknown"}`);
    }
}

function taskId(payload: unknown) {
    return firstString(
        readPath(payload, "id"),
        readPath(payload, "task_id"),
        readPath(payload, "data.id"),
        readPath(payload, "data.0.id"),
        readPath(payload, "output.task_id"),
        readPath(payload, "task.id"),
    );
}

function taskStatus(payload: unknown) {
    const value = firstString(
        readPath(payload, "status"),
        readPath(payload, "state"),
        readPath(payload, "data.status"),
        readPath(payload, "data.0.status"),
        readPath(payload, "output.task_status"),
        readPath(payload, "task.status"),
    ).toLowerCase();
    if (value === "succeed") return "completed";
    if (["expired", "violation", "unknown"].includes(value)) return "failed";
    return normalizeDirectStatus(value);
}

function taskError(payload: unknown) {
    const status = taskStatus(payload);
    if (status !== "failed") return readDirectError(payload);
    return firstString(
        readPath(payload, "error.message"),
        readPath(payload, "error"),
        readPath(payload, "data.0.error.message"),
        readPath(payload, "data.0.message"),
        readPath(payload, "output.message"),
        readPath(payload, "task.error.message"),
        readPath(payload, "message"),
        readPath(payload, "msg"),
        "TokenDance 任务执行失败",
    );
}

function imageURLs(payload: unknown) {
    const data = readPath(payload, "data");
    const openAIImages = Array.isArray(data) ? data.flatMap((item) => {
        const url = readString(readPath(item, "url"));
        const base64 = readString(readPath(item, "b64_json"));
        return url ? [url] : base64 ? [base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`] : [];
    }) : [];
    const values = [
        data,
        readPath(payload, "results"),
        readPath(payload, "output"),
    ].flatMap(collectHTTPURLs);
    return [...new Set([...openAIImages, ...uniqueHTTPURLs(values)])];
}

function videoURL(payload: unknown) {
    const outputs = readPath(payload, "data.0.outputs");
    const video = Array.isArray(outputs)
        ? outputs.find((item) => readString(readPath(item, "type")).toLowerCase() === "video")
        : undefined;
    return firstString(
        readPath(payload, "content.video_url"),
        readPath(payload, "output.video_url"),
        readPath(payload, "task.content.url"),
        readPath(video, "url"),
    );
}

export function tokenDanceRecoveryMessage(action: string | null) {
    switch ((action || "").trim()) {
        case "top_up_balance": return "TokenDance 余额不足，请充值后重试";
        case "reauthorize_api_key": return "TokenDance API Key 已失效，请重新授权";
        case "api_key_quota": return "TokenDance API Key 已达到周期额度，请等待额度刷新或重新授权";
        default: return "";
    }
}

export const tokenDanceDirectProtocol: DirectProtocolAdapter = {
    headers: { "X-App-URL": tokenDanceAppUrl },
    pollPath: (pollId) => {
        const { protocol, taskId: id } = splitTaskID(pollId);
        return pollPath(protocol, id);
    },
    pollURL(baseUrl, pollId) {
        return gatewayURL(baseUrl, this.pollPath(pollId));
    },
    readTaskId: taskId,
    readCreatedImageURLs: imageURLs,
    readCreatedVideoStatus: taskStatus,
    readError: taskError,
    readImagePoll(payload) {
        const urls = imageURLs(payload);
        const status = taskStatus(payload);
        return { urls, done: status === "completed" || status === "failed", error: taskError(payload) };
    },
    readVideoPoll(payload, pollId, model) {
        const url = videoURL(payload);
        const status = url ? "completed" : taskStatus(payload);
        const error = status === "failed" ? taskError(payload) || "TokenDance 视频生成失败" : taskError(payload);
        const progress = readNumber(readPath(payload, "progress")) ?? readNumber(readPath(payload, "data.0.progress"));
        return {
            id: pollId,
            task_id: pollId,
            status,
            ...(progress !== undefined ? { progress } : {}),
            ...(url ? { video_url: url, url } : {}),
            ...(error ? { error: { message: error } } : {}),
            model,
        };
    },
};
