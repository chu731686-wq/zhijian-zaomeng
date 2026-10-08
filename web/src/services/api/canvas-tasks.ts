import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import { apiGet, apiPost } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";
import axios from "axios";

export type TeamCanvas = CanvasProject & { userId?: string; team_id?: string | null; team_name?: string; can_edit?: boolean; can_manage_access?: boolean };
export type CanvasAccess = { mode: "team" | "custom"; members: { user_id: string; permission: "edit" | "view" }[] };

async function collabRequest<T>(method: string, url: string, token: string, data?: unknown): Promise<T> {
    const response = await axios.request<{ code: number; data: T; msg: string }>({ method, url, data, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
    if (response.status < 200 || response.status >= 300 || response.data?.code !== 0) throw new Error(response.data?.msg || "请求失败");
    return response.data.data;
}

export async function listCanvasProjects(token: string) {
    return apiGet<CanvasProject[]>("/api/v1/canvas/projects", undefined, token);
}

export async function saveCanvasProject(
    token: string,
    project: CanvasProject,
) {
    if (project.team_id) return project;
    return apiPost<CanvasProject>(
        "/api/v1/canvas/projects",
        { data: project },
        token,
    );
}

export async function createTeamCanvasProject(token: string, project: CanvasProject, teamId: string) {
    return apiPost<CanvasProject>("/api/v1/canvas/projects", { data: project, team_id: teamId }, token);
}

export const moveCanvasProjectToTeam = (token: string, projectId: string, teamId: string) => collabRequest<{ moved: boolean }>("POST", `/api/v1/canvas/projects/${projectId}/move-to-team`, token, { team_id: teamId });
export const deleteTeamCanvasProject = (token: string, projectId: string) => collabRequest<{ deleted: boolean }>("DELETE", `/api/v1/canvas/projects/${projectId}`, token);
export const getCanvasAccess = (token: string, projectId: string) => collabRequest<CanvasAccess>("GET", `/api/v1/canvas/projects/${projectId}/access`, token);
export const setCanvasAccess = (token: string, projectId: string, access: CanvasAccess) => collabRequest<CanvasAccess>("PUT", `/api/v1/canvas/projects/${projectId}/access`, token, access);

export async function syncCanvasProjects(
    token: string,
    projects: CanvasProject[],
) {
    const personalProjects = projects.filter((project) => !project.team_id);
    if (projects.length && !personalProjects.length) return [];
    return apiPost<CanvasProject[]>(
        "/api/v1/canvas/projects/sync",
        { projects: personalProjects },
        token,
    );
}

export async function deleteCanvasTasks(sourceId: string, nodeIds: string[] = []) {
    const token = useUserStore.getState().token;
    const source = sourceId.trim();
    if (!token || !source) return;
    return apiPost<{ deleted: boolean }>(
        "/api/v1/canvas/tasks/delete",
        {
            source_id: source,
            node_ids: Array.from(new Set(nodeIds.map((id) => id.trim()).filter(Boolean))),
        },
        token,
    );
}

export async function deleteCanvasProjects(ids: string[], token = useUserStore.getState().token) {
    const projectIds = Array.from(
        new Set(ids.map((id) => id.trim()).filter(Boolean)),
    );
    if (!token || !projectIds.length) return;
    return apiPost<{ deleted: boolean }>(
        "/api/v1/canvas/projects/delete",
        { ids: projectIds },
        token,
    );
}
