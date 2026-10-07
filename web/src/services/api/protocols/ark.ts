import { firstString, normalizeDirectStatus, readDirectError, readPath, readString } from "./shared";
import type { DirectProtocolAdapter } from "./types";

export const arkDirectProtocol: DirectProtocolAdapter = {
    pollPath: (taskId) => `/contents/generations/tasks/${encodeURIComponent(taskId)}`,
    readTaskId: (payload) => readString(readPath(payload, "id")),
    readCreatedVideoStatus: (payload) => normalizeDirectStatus(readString(readPath(payload, "status"))),
    readError: readDirectError,
    readImagePoll: () => ({ urls: [], done: false, error: "火山方舟渠道不支持图片任务" }),
    readVideoPoll(payload, pollId, model) {
        const videoUrl = readString(readPath(payload, "content.video_url"));
        const upstreamError = readDirectError(payload);
        const statusValue = firstString(readPath(payload, "status"), videoUrl ? "completed" : upstreamError ? "failed" : "processing");
        const status = statusValue.toLowerCase() === "expired" ? "failed" : normalizeDirectStatus(statusValue);
        const error = status === "failed" ? upstreamError || "视频生成失败" : upstreamError;
        return {
            id: firstString(readPath(payload, "id"), pollId),
            task_id: firstString(readPath(payload, "id"), pollId),
            status,
            ...(videoUrl ? { video_url: videoUrl, url: videoUrl } : {}),
            ...(error ? { error: { message: error } } : {}),
            model,
        };
    },
};
