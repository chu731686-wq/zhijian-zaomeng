import { asRecord, collectHTTPURLs, firstHTTPURL, firstString, normalizeDirectStatus, readDirectError, readNumber, readPath, readString, uniqueHTTPURLs } from "./shared";
import type { DirectProtocolAdapter } from "./types";

export const apimartDirectProtocol: DirectProtocolAdapter = {
    pollPath: (taskId) => `/tasks/${encodeURIComponent(taskId)}?language=zh`,
    readTaskId: (payload) => firstString(readPath(payload, "data.0.task_id"), readPath(payload, "data.task_id"), readPath(payload, "data.id")),
    readCreatedVideoStatus: (payload) => normalizeDirectStatus(readString(readPath(payload, "data.0.status"))),
    readError: readDirectError,
    readCreatedImageURLs(payload) {
        const data = readPath(payload, "data");
        if (Array.isArray(data)) return uniqueHTTPURLs(data.flatMap((item) => collectHTTPURLs(asRecord(item).url)));
        return [];
    },
    readImagePoll(payload) {
        const data = asRecord(readPath(payload, "data"));
        const images = readPath(data, "result.images");
        const urls = uniqueHTTPURLs(Array.isArray(images) ? images.flatMap((image) => collectHTTPURLs(readPath(image, "url"))) : []);
        const status = normalizeDirectStatus(firstString(data.status, urls.length ? "completed" : "processing"));
        return { urls, done: status === "completed", error: status === "failed" ? firstString(readPath(data, "error.message"), readDirectError(payload), "图片生成失败") : "" };
    },
    readVideoPoll(payload, pollId, model) {
        const data = asRecord(readPath(payload, "data"));
        const error = firstString(readPath(data, "error.message"), readDirectError(payload));
        const videoUrl = firstHTTPURL(data.result);
        return {
            id: firstString(data.id, pollId),
            task_id: firstString(data.id, pollId),
            status: normalizeDirectStatus(firstString(data.status, videoUrl ? "completed" : "processing")),
            progress: readNumber(data.progress),
            ...(videoUrl ? { video_url: videoUrl, url: videoUrl } : {}),
            ...(error ? { error: { message: error } } : {}),
            model,
        };
    },
};
