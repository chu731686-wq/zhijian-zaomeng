import axios from "axios";
import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";

export type CanvasPatch = {
    set?: Record<string, unknown>;
    upsert?: Record<string, Array<Record<string, unknown> & { id: string }>>;
    delete?: Record<string, string[]>;
};
export type CanvasPresence = { user_id: string; name: string; avatar?: string; selected_ids: string[] };
export type CanvasSnapshot = { project_data: CanvasProject; revision: number; can_edit: boolean; can_manage_access: boolean };
export type CanvasChanges = CanvasSnapshot & { reset?: boolean; changes?: { revision: number; user_id: string; patch: CanvasPatch }[]; online: CanvasPresence[] };
export class CanvasCollabError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}
async function request<T>(token: string, id: string, suffix: string, data?: unknown): Promise<T> {
    const response = await axios.request<{ code: number; data: T; msg: string }>({
        method: data ? "POST" : "GET", url: `/api/v1/canvas/projects/${encodeURIComponent(id)}${suffix}`,
        data, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300 || response.data?.code !== 0) throw new CanvasCollabError(response.status, response.data?.msg || "画布同步失败");
    return response.data.data;
}
export const getCanvasProject = (token: string, id: string) => request<CanvasProject>(token, id, "");
export const getCanvasSnapshot = (token: string, id: string) => request<CanvasSnapshot>(token, id, "/snapshot");
export const getCanvasChanges = (token: string, id: string, since: number, selected: string[]) => request<CanvasChanges>(token, id, `/changes?since=${since}&selected=${encodeURIComponent(selected.join(","))}`);
export const postCanvasPatch = (token: string, id: string, revision: number, patch: CanvasPatch) => request<{ revision: number }>(token, id, "/patches", { base_revision: revision, patch });
