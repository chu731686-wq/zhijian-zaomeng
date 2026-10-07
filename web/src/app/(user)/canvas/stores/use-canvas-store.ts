import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { deleteCanvasProjects, listCanvasProjects, saveCanvasProject, syncCanvasProjects } from "@/services/api/canvas-tasks";
import { accountScope, accountStorageKey, readAccountState, reportAccountSyncFailure, waitForUserHydration } from "@/services/account-storage";
import { ensureFileSession } from "@/services/api/file-session";
import { syncMediaReferences } from "@/services/sync-media";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAgentConfig, CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasPendingAgentRequest, ViewportTransform } from "../types";

export type CanvasSidePanelState = {
    open: boolean;
    width: number;
};

export const DEFAULT_CANVAS_SIDE_PANEL: CanvasSidePanelState = { open: true, width: 280 };
export const DEFAULT_CANVAS_AGENT_PANEL: CanvasSidePanelState = { open: false, width: 380 };

const normalizeCanvasAgentPanel = (panel: CanvasSidePanelState | undefined): CanvasSidePanelState =>
    panel ? { ...panel, width: Math.max(320, panel.width) } : DEFAULT_CANVAS_AGENT_PANEL;

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    agentConfig: CanvasAgentConfig | null;
    autoTitlePending: boolean;
    pendingAgentRequest?: CanvasPendingAgentRequest;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    sidePanel: CanvasSidePanelState;
    agentPanel: CanvasSidePanelState;
};

type CanvasStore = {
    hydrated: boolean;
    deletedProjectIds: string[];
    importedLocalProjectIds: string[];
    projects: CanvasProject[];
    createProject: (title?: string, options?: { agentConfig?: CanvasAgentConfig; pendingAgentRequest?: CanvasPendingAgentRequest }) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "agentConfig" | "autoTitlePending" | "backgroundMode" | "showImageInfo" | "viewport" | "sidePanel" | "agentPanel" | "pendingAgentRequest">>) => void;
    syncWithRemote: (token: string, syncEnabled: boolean) => Promise<void>;
    setSyncEnabled: (enabled: boolean) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjectIds" | "importedLocalProjectIds">;
let pendingLocalWrite: { key: string; value: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let accountCanvasSyncEnabled = false;
let canvasScope = "";
let canvasSyncRequest: { token: string; request: Promise<void> } | null = null;
const projectSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function includeLocalProjects(local: PersistedCanvasState | null, token: string): Promise<PersistedCanvasState> {
    const snapshot = {
        projects: local?.projects || [],
        deletedProjectIds: local?.deletedProjectIds || [],
        importedLocalProjectIds: local?.importedLocalProjectIds || [],
    };
    if (!token) return snapshot;
    const guest = await readAccountState<PersistedCanvasState>(CANVAS_STORE_KEY, "");
    // Both stores may contain old guest data; read them without removing either copy.
    const legacyValue = window.localStorage.getItem(CANVAS_STORE_KEY);
    const legacy = legacyValue ? JSON.parse(legacyValue).state as PersistedCanvasState : null;
    const deletedIds = new Set([...(guest?.deletedProjectIds || []), ...(legacy?.deletedProjectIds || []), ...snapshot.deletedProjectIds]);
    const importedIds = new Set(snapshot.importedLocalProjectIds);
    const projects = mergeCanvasProjects(guest?.projects || [], legacy?.projects || [])
        .filter((project) => !deletedIds.has(project.id) && !importedIds.has(project.id));
    return {
        ...snapshot,
        projects: mergeCanvasProjects(snapshot.projects, projects),
        importedLocalProjectIds: [...new Set([...importedIds, ...projects.map((project) => project.id)])],
    };
}

function queueProjectSave(project: CanvasProject) {
    const token = useUserStore.getState().token;
    const syncEnabled = accountCanvasSyncEnabled;
    const previous = projectSaveTimers.get(project.id);
    if (previous) clearTimeout(previous);

    projectSaveTimers.set(
        project.id,
        setTimeout(() => {
            projectSaveTimers.delete(project.id);
            if (
                !token ||
                !syncEnabled ||
                !accountCanvasSyncEnabled ||
                canvasScope !== accountScope(token) ||
                useUserStore.getState().token !== token
            ) {
                return;
            }
            void (async () => {
                const prepared = await syncMediaReferences(project, token);
                if (useUserStore.getState().token !== token) return;
                const saved = await saveCanvasProject(token, prepared);
                if (useUserStore.getState().token !== token) return;
                useCanvasStore.setState((state) => ({ projects: state.projects.map((item) =>
                    item.id === project.id && item.updatedAt === project.updatedAt ? saved : item) }));
            })().catch(reportAccountSyncFailure);
        }, 400),
    );
}

function cancelProjectSaves(ids: string[]) {
    ids.forEach((id) => {
        const timer = projectSaveTimers.get(id);
        if (!timer) return;
        clearTimeout(timer);
        projectSaveTimers.delete(id);
    });
}

async function reconcileCanvasProjects(
    token: string,
    remoteProjects: CanvasProject[],
    localProjects: CanvasProject[],
    deletedProjectIds: string[] = [],
) {
    if (deletedProjectIds.length) await deleteCanvasProjects(deletedProjectIds, token);
    remoteProjects = remoteProjects.filter((project) => !deletedProjectIds.includes(project.id));
    localProjects = localProjects.filter((project) => !deletedProjectIds.includes(project.id));
    const remoteById = new Map(
        remoteProjects.map((project) => [project.id, project]),
    );
    const missingProjects = localProjects.filter(
        (project) => !remoteById.has(project.id),
    );
    const existingLocalProjects = localProjects.filter((project) =>
        remoteById.has(project.id),
    );
    let projects = mergeCanvasProjects(remoteProjects, existingLocalProjects);
    for (let index = 0; index < missingProjects.length; index += 10) {
        const batch = [];
        for (const project of missingProjects.slice(index, index + 10)) batch.push(await syncMediaReferences(project, token));
        const saved = await syncCanvasProjects(token, batch);
        projects = mergeCanvasProjects(saved, projects);
    }

    localProjects.forEach((project) => {
        const remote = remoteById.get(project.id);
        if (
            remote &&
            Date.parse(project.updatedAt || "") >
            Date.parse(remote.updatedAt || "")
        ) {
            queueProjectSave(project);
        }
    });

    return projects;
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        await waitForUserHydration();
        const token = useUserStore.getState().token;
        canvasScope = accountScope(token);
        const value = await localForageStorage.getItem(accountStorageKey(name, canvasScope));
        let local = value ? JSON.parse(value) as StorageValue<CanvasStore> : null;
        accountCanvasSyncEnabled = Boolean(token);
        if (token) {
            try {
                const snapshot = await includeLocalProjects(local?.state || null, token);
                if (useUserStore.getState().token !== token) return null;
                local = { state: snapshot, version: 0 } as StorageValue<CanvasStore>;
                // Keep imported projects in the account cache even when uploading fails.
                await localForageStorage.setItem(accountStorageKey(name, canvasScope), JSON.stringify(local));
                await ensureFileSession(token);
                const remote = await listCanvasProjects(token);
                if (useUserStore.getState().token !== token) return null;
                const projects = await reconcileCanvasProjects(token, remote, local?.state.projects || [], local?.state.deletedProjectIds || []);
                if (useUserStore.getState().token !== token) return null;
                queuedPersistState = { ...snapshot, projects };
                return { state: queuedPersistState, version: 0 } as StorageValue<CanvasStore>;
            } catch (error) {
                if (useUserStore.getState().token !== token) return null;
                reportAccountSyncFailure(error);
            }
        }
        queuedPersistState = local?.state || null;
        return local;
    },

    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (
            queuedPersistState &&
            queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjectIds === nextState.deletedProjectIds &&
            queuedPersistState.importedLocalProjectIds === nextState.importedLocalProjectIds
        ) {
            return;
        }
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        const key = accountStorageKey(name, canvasScope);
        pendingLocalWrite = { key, value: JSON.stringify(value) };
        saveTimer = setTimeout(() => {
            saveTimer = null;
            const pending = pendingLocalWrite;
            pendingLocalWrite = null;
            if (pending) void localForageStorage.setItem(pending.key, pending.value);
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(accountStorageKey(name, canvasScope)),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjectIds: [],
            importedLocalProjectIds: [],
            createProject: (title = "未命名画布", options) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    agentConfig: options?.agentConfig || null,
                    autoTitlePending: true,
                    pendingAgentRequest: options?.pendingAgentRequest,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                    sidePanel: DEFAULT_CANVAS_SIDE_PANEL,
                    agentPanel: options?.pendingAgentRequest ? { ...DEFAULT_CANVAS_AGENT_PANEL, open: true } : DEFAULT_CANVAS_AGENT_PANEL,
                };
                set((state) => ({
                    projects: [project, ...state.projects],
                }));
                queueProjectSave(project);
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: (source.chatSessions || []).map((session) => ({ ...session, codexThreadId: undefined, codexServiceId: undefined })),
                    activeChatId: source.activeChatId || null,
                    agentConfig: source.agentConfig || null,
                    autoTitlePending: false,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                    sidePanel: source.sidePanel || DEFAULT_CANVAS_SIDE_PANEL,
                    agentPanel: normalizeCanvasAgentPanel(source.agentPanel),
                };
                set((state) => ({
                    projects: [project, ...state.projects],
                }));
                queueProjectSave(project);
                return project.id;
            },
            openProject: (id) =>
                get().projects.find((item) => item.id === id) || null,
            renameProject: (id, title) => {
                const project = get().projects.find(
                    (item) => item.id === id,
                );
                if (!project) return;
                const nextProject = {
                    ...project,
                    title: title.trim() || project.title,
                    autoTitlePending: false,
                    updatedAt: new Date().toISOString(),
                };
                set((state) => ({
                    projects: state.projects.map((item) =>
                        item.id === id ? nextProject : item,
                    ),
                }));
                queueProjectSave(nextProject);
            },
            deleteProjects: (ids) => {
                cancelProjectSaves(ids);
                set((state) => ({
                    projects: state.projects.filter(
                        (project) => !ids.includes(project.id),
                    ),
                    deletedProjectIds: Array.from(new Set([...state.deletedProjectIds, ...ids])),
                }));
                const token = useUserStore.getState().token;
                if (token && accountCanvasSyncEnabled && canvasScope === accountScope(token)) void deleteCanvasProjects(ids, token).catch(reportAccountSyncFailure);
            },
            updateProject: (id, patch) => {
                const project = get().projects.find(
                    (item) => item.id === id,
                );
                if (!project) return;
                const nextProject = {
                    ...project,
                    ...patch,
                    updatedAt: new Date().toISOString(),
                };
                set((state) => ({
                    projects: state.projects.map((item) =>
                        item.id === id ? nextProject : item,
                    ),
                }));
                queueProjectSave(nextProject);
            },
            syncWithRemote: async (token, syncEnabled) => {
                if (canvasSyncRequest?.token === token) return canvasSyncRequest.request;
                const request = (async () => {
                    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
                    const pending = pendingLocalWrite;
                    pendingLocalWrite = null;
                    if (pending) await localForageStorage.setItem(pending.key, pending.value);
                    const scope = accountScope(token);
                    const cached = canvasScope === scope ? { projects: get().projects, deletedProjectIds: get().deletedProjectIds, importedLocalProjectIds: get().importedLocalProjectIds }
                        : await readAccountState<PersistedCanvasState>(CANVAS_STORE_KEY, scope);
                    const local = await includeLocalProjects(cached, token);
                    if (useUserStore.getState().token !== token) return;
                    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
                    cancelProjectSaves(Array.from(projectSaveTimers.keys()));
                    canvasScope = scope;
                    accountCanvasSyncEnabled = Boolean(token && syncEnabled);
                    queuedPersistState = null;
                    set(local);
                    if (token) await localForageStorage.setItem(accountStorageKey(CANVAS_STORE_KEY, scope), JSON.stringify({ state: local, version: 0 }));
                    if (!token || !syncEnabled) return;
                    await ensureFileSession(token);
                    const remote = await listCanvasProjects(token);
                    if (useUserStore.getState().token !== token) return;
                    const projects = await reconcileCanvasProjects(token, remote, get().projects, get().deletedProjectIds);
                    if (useUserStore.getState().token !== token) return;
                    const nextState = { projects: mergeCanvasProjects(projects, get().projects.filter((item) =>
                        !local.projects.some((old) => old.id === item.id && old.updatedAt === item.updatedAt))).filter((item) => !get().deletedProjectIds.includes(item.id)), deletedProjectIds: get().deletedProjectIds, importedLocalProjectIds: get().importedLocalProjectIds };
                    queuedPersistState = null;
                    set(nextState);
                    await localForageStorage.setItem(accountStorageKey(CANVAS_STORE_KEY, scope), JSON.stringify({ state: nextState, version: 0 }));
                })();
                canvasSyncRequest = { token, request };
                try { await request; } finally {
                    if (canvasSyncRequest?.request === request) canvasSyncRequest = null;
                    if (useUserStore.getState().token === token) set({ hydrated: true });
                }
            },
            setSyncEnabled: (enabled) => {
                accountCanvasSyncEnabled = enabled;
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjectIds: state.deletedProjectIds,
                    importedLocalProjectIds: state.importedLocalProjectIds,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (state) => {
                if (state) {
                    useCanvasStore.setState({
                        projects: state.projects.map((project) => ({ ...project, agentPanel: normalizeCanvasAgentPanel(project.agentPanel) })),
                        hydrated: true,
                    });
                } else {
                    useCanvasStore.setState({ hydrated: true });
                }
            },
        },
    ),
);

export function mergeCanvasProjects(
    remoteProjects: CanvasProject[],
    localProjects: CanvasProject[],
): CanvasProject[] {
    const projects = new Map<string, CanvasProject>();
    [...localProjects, ...remoteProjects].forEach((project) => {
        const previous = projects.get(project.id);
        if (
            !previous ||
            Date.parse(project.updatedAt || "") >=
            Date.parse(previous.updatedAt || "")
        ) {
            projects.set(project.id, { ...project, agentPanel: normalizeCanvasAgentPanel(project.agentPanel) });
        }
    });
    return Array.from(projects.values()).sort(
        (a, b) =>
            Date.parse(b.updatedAt || "") -
            Date.parse(a.updatedAt || ""),
    );
}
// Hide the previous account's editor until its replacement cache is loaded.
useUserStore.subscribe((state, previous) => {
    if (accountScope(state.token) !== accountScope(previous.token)) useCanvasStore.setState({ hydrated: false });
});
