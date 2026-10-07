"use client";

import { create } from "zustand";
import { listShowcaseProjects, setProjectPublished, type ShowcaseProject } from "@/services/api/showcase";
import { saveCanvasProject } from "@/services/api/canvas-tasks";
import { ensureFileSession } from "@/services/api/file-session";
import { syncMediaReferences } from "@/services/sync-media";
import { useCanvasStore, type CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useUserStore } from "./use-user-store";

type ShowcaseStore = { items: ShowcaseProject[]; error: string; loading: boolean; refresh: () => Promise<void>; publish: (project: CanvasProject, published: boolean) => Promise<void> };
let activeRequest: { token: string; promise: Promise<void> } | null = null;
export const useShowcaseStore = create<ShowcaseStore>((set, get) => ({
    items: [], error: "", loading: false,
    refresh: () => {
        const token = useUserStore.getState().token;
        if (!token) { set({ items: [], error: "", loading: false }); return Promise.resolve(); }
        if (activeRequest?.token === token) return activeRequest.promise;
        set({ loading: true, error: "" });
        const promise = (async () => {
            try {
                await ensureFileSession(token);
                const items = await listShowcaseProjects(token);
                if (useUserStore.getState().token === token) set({ items, error: "" });
            } catch (error) {
                if (useUserStore.getState().token === token) set({ error: error instanceof Error ? error.message : "作品加载失败" });
            } finally {
                if (useUserStore.getState().token === token) set({ loading: false });
                if (activeRequest?.token === token) activeRequest = null;
            }
        })();
        activeRequest = { token, promise };
        return promise;
    },
    publish: async (project, published) => {
        const { token, user } = useUserStore.getState();
        if (!token || user?.role !== "admin") throw new Error("仅管理员可发布自己的画布");
        if (published) {
            const latest = useCanvasStore.getState().projects.find((item) => item.id === project.id);
            if (!latest) throw new Error("画布项目不存在");
            await saveCanvasProject(token, await syncMediaReferences(latest, token));
        }
        await setProjectPublished(project.id, published, token);
        await get().refresh();
    },
}));
useUserStore.subscribe((state, previous) => {
    if (state.token !== previous.token) useShowcaseStore.setState({ items: [], error: "", loading: false });
});
