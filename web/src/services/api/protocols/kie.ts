import { asRecord, collectHTTPURLs, firstHTTPURL, firstString, normalizeDirectStatus, parseJSONValue, readDirectError, readNumber, readPath, readString, uniqueHTTPURLs } from "./shared";
import type { DirectProtocolAdapter } from "./types";

export const kieDirectProtocol: DirectProtocolAdapter = {
    pollPath: (taskId) => `/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    readTaskId: (payload) => readString(readPath(payload, "data.taskId")),
    readCreatedVideoStatus: () => normalizeDirectStatus("processing"),
    readError: readDirectError,
    readImagePoll(payload) {
        const data = asRecord(readPath(payload, "data"));
        const urls = uniqueHTTPURLs(collectHTTPURLs(parseJSONValue(data.resultJson)));
        const status = normalizeDirectStatus(firstString(data.state, urls.length ? "completed" : "processing"));
        return { urls, done: status === "completed", error: status === "failed" ? firstString(data.failMsg, data.failCode, readDirectError(payload), "图片生成失败") : "" };
    },
    readVideoPoll(payload, pollId, model) {
        const data = asRecord(readPath(payload, "data"));
        const error = firstString(data.failMsg, data.failCode, readDirectError(payload));
        const videoUrl = firstHTTPURL(parseJSONValue(data.resultJson));
        return {
            id: firstString(data.taskId, pollId),
            task_id: firstString(data.taskId, pollId),
            status: normalizeDirectStatus(firstString(data.state, videoUrl ? "completed" : "processing")),
            progress: readNumber(data.progress),
            ...(videoUrl ? { video_url: videoUrl, url: videoUrl } : {}),
            ...(error ? { error: { message: error } } : {}),
            model,
        };
    },
};
