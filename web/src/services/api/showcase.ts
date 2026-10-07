import { apiGet, apiPost } from "./request";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";

export type ShowcaseProject = { id: string; title: string; ownerName: string; updatedAt: string; coverFileId: string; nodeCount: number };
export const listShowcaseProjects = (token = useUserStore.getState().token) => apiGet<ShowcaseProject[]>("/api/v1/showcase", undefined, token);
export const getShowcaseProject = (id: string, token = useUserStore.getState().token) => apiGet<{ project: CanvasProject; ownerName: string }>(`/api/v1/showcase/${encodeURIComponent(id)}`, undefined, token);
export const setProjectPublished = (id: string, published: boolean, token = useUserStore.getState().token) => apiPost<boolean>(`/api/v1/canvas/projects/${encodeURIComponent(id)}/publish`, { published }, token);
