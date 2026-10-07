import { useCanvasStore, mergeCanvasProjects, type CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import { mergeAssetSnapshots, useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { readAccountState } from "./account-storage";
import { listCanvasProjects, syncCanvasProjects } from "./api/canvas-tasks";
import { fetchUserAssetData, syncUserAssetData } from "./api/user-config";
import { syncMediaReferences } from "./sync-media";

export type LocalAccountImport = { projects: CanvasProject[]; assets: Asset[] };

function checkSession(token: string) {
    if (!token || useUserStore.getState().token !== token) throw new Error("登录状态已变化，请重新导入");
}

export async function findLocalAccountImport(token: string): Promise<LocalAccountImport> {
    checkSession(token);
    const [localCanvas, localAssets, projects, assets] = await Promise.all([
        readAccountState<{ projects: CanvasProject[] }>("infinite-canvas:canvas_store", ""),
        readAccountState<{ assets: Asset[] }>("infinite-canvas:asset_store", ""),
        listCanvasProjects(token),
        fetchUserAssetData<{ assets: Asset[]; deletedAssets?: Record<string, string> }>(token),
    ]);
    checkSession(token);
    const projectIds = new Set(projects.map((project) => project.id));
    const assetIds = new Set(assets.assets.map((asset) => asset.id));
    return {
        projects: (localCanvas?.projects || []).filter((project) => !projectIds.has(project.id)),
        assets: (localAssets?.assets || []).filter((asset) => !assetIds.has(asset.id) && !assets.deletedAssets?.[asset.id]),
    };
}

export async function importLocalAccountData(token: string, onProgress: (done: number, total: number) => void) {
    // Recount after confirmation so a retry skips batches that already reached the server.
    const local = await findLocalAccountImport(token);
    const total = local.projects.length + local.assets.length;
    let done = 0;
    onProgress(done, total);
    for (let index = 0; index < local.projects.length; index += 10) {
        const batch = [];
        for (const project of local.projects.slice(index, index + 10)) batch.push(await syncMediaReferences(project, token));
        checkSession(token);
        const saved = await syncCanvasProjects(token, batch);
        checkSession(token);
        useCanvasStore.setState((state) => ({ projects: mergeCanvasProjects(saved, state.projects).filter((project) => !state.deletedProjectIds.includes(project.id)) }));
        done += batch.length;
        onProgress(done, total);
    }
    for (let index = 0; index < local.assets.length; index += 20) {
        const batch = [];
        for (const asset of local.assets.slice(index, index + 20)) batch.push(await syncMediaReferences(asset, token));
        checkSession(token);
        const saved = await syncUserAssetData(token, { assets: batch });
        checkSession(token);
        useAssetStore.setState((state) => mergeAssetSnapshots(saved, state));
        done += batch.length;
        onProgress(done, total);
    }
}
