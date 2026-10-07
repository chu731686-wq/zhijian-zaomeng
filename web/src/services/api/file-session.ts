import { apiDelete, apiPost } from "./request";
import { useUserStore } from "@/stores/use-user-store";

let sessionToken = "";
let sessionRequest: Promise<unknown> | null = null;
let sessionQueue: Promise<unknown> = Promise.resolve();

export async function ensureFileSession(token = useUserStore.getState().token) {
    if (!token) return;
    if (sessionToken !== token || !sessionRequest) {
        sessionToken = token;
        const request = sessionQueue.catch(() => {}).then(() => {
            if (useUserStore.getState().token !== token) throw new Error("登录状态已变化");
            return apiPost<boolean>("/api/v1/files/session", {}, token);
        });
        sessionQueue = request;
        sessionRequest = request.catch((error) => {
            if (sessionToken === token) sessionRequest = null;
            throw error;
        });
    }
    await sessionRequest;
    if (useUserStore.getState().token !== token) throw new Error("登录状态已变化");
}

export async function clearFileSession() {
    sessionToken = "";
    sessionRequest = null;
    const request = sessionQueue.catch(() => {}).then(() => apiDelete<boolean>("/api/files/session"));
    sessionQueue = request;
    await request;
}
