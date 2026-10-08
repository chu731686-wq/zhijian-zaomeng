import axios from "axios";

export type TeamAssetKind = "image" | "video" | "audio" | "text";
export type TeamAssetCategory = "人物" | "场景" | "道具" | "分集" | "其他";
export type TeamAsset = { id: string; team_id: string; created_by: string; kind: TeamAssetKind; name: string; category: TeamAssetCategory; file_url?: string; text_content?: string; created_at: string };

async function request<T>(method: string, path: string, token: string, data?: unknown): Promise<T> {
    const response = await axios.request<{ code: number; data: T; msg: string }>({
        method, url: `/api/v1${path}`, data, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300 || response.data?.code !== 0) throw new Error(response.data?.msg || "请求失败");
    return response.data.data;
}

export const getTeamAssets = (token: string, teamId: string, params: { kind?: TeamAssetKind; category?: TeamAssetCategory | "" } = {}) => {
    const query = new URLSearchParams();
    if (params.kind) query.set("kind", params.kind);
    if (params.category) query.set("category", params.category);
    return request<TeamAsset[]>("GET", `/teams/${teamId}/assets${query.size ? `?${query}` : ""}`, token);
};
export const createTeamAsset = (token: string, teamId: string, asset: Pick<TeamAsset, "kind" | "name" | "category" | "file_url" | "text_content">) => request<TeamAsset>("POST", `/teams/${teamId}/assets`, token, asset);
export const updateTeamAsset = (token: string, teamId: string, assetId: string, patch: { name?: string; category?: TeamAssetCategory }) => request<TeamAsset>("PATCH", `/teams/${teamId}/assets/${assetId}`, token, patch);
export const deleteTeamAsset = (token: string, teamId: string, assetId: string) => request<TeamAsset>("DELETE", `/teams/${teamId}/assets/${assetId}`, token);
