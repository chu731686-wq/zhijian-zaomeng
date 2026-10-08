import axios from "axios";

export type TeamRole = "owner" | "admin" | "editor" | "viewer";
export type Team = { id: string; name: string; role: TeamRole; member_count: number; owner_id?: string };
export type TeamMember = { id: string; user_id: string; name: string; avatar?: string; role: TeamRole; can_use_team_api: boolean };
export type TeamDetail = Team & { members: TeamMember[] };
export type TeamInvitePreview = { team_name: string; inviter_name: string; is_member: boolean; expired: boolean; revoked: boolean; role: TeamRole };

async function request<T>(method: string, path: string, token: string, data?: unknown): Promise<T> {
    const response = await axios.request<{ code: number; data: T; msg: string }>({
        method, url: `/api/v1${path}`, data, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300 || response.data?.code !== 0) throw new Error(response.data?.msg || "请求失败");
    return response.data.data;
}

export const getTeams = (token: string) => request<Team[]>("GET", "/teams", token);
export const getTeam = (token: string, id: string) => request<TeamDetail>("GET", `/teams/${id}`, token);
export const createTeam = (token: string, name: string) => request<Team>("POST", "/teams", token, { name });
export const renameTeam = (token: string, id: string, name: string) => request("PATCH", `/teams/${id}`, token, { name });
export const dissolveTeam = (token: string, id: string) => request("DELETE", `/teams/${id}`, token);
export const removeTeamMember = (token: string, id: string, userId: string) => request("DELETE", `/teams/${id}/members/${userId}`, token);
export const updateTeamMember = (token: string, id: string, userId: string, data: { role?: TeamRole; can_use_team_api?: boolean }) => request("PATCH", `/teams/${id}/members/${userId}`, token, data);
export const transferTeam = (token: string, id: string, userId: string) => request("POST", `/teams/${id}/transfer`, token, { user_id: userId });
export const createTeamInvite = (token: string, id: string, role: "editor" | "viewer") => request<{ token: string }>("POST", `/teams/${id}/invites`, token, { role });
export const previewTeamInvite = (token: string, invite: string) => request<TeamInvitePreview>("GET", `/team-invites/${invite}`, token);
export const acceptTeamInvite = (token: string, invite: string) => request<{ id: string }>("POST", `/team-invites/${invite}/accept`, token);

export type TeamSharedChannel = Omit<import("@/stores/use-config-store").LocalModelChannel, "id" | "models" | "apiKey" | "baseUrl"> & {
    channel_id: string; can_use: boolean; base_path?: string;
    models: Array<{ id: string; name: string; type: string }>;
};
export type TeamAPIUsage = { id: number; created_at: string; member_name: string; user_id: string; model: string; status: number };
export const getTeamSharedChannels = (token: string, id: string) => request<TeamSharedChannel[]>("GET", `/teams/${id}/shared-channels`, token);
export const saveTeamSharedChannels = (token: string, id: string, channel_ids: string[]) => request<TeamSharedChannel[]>("PUT", `/teams/${id}/shared-channels`, token, { channel_ids });
export const getTeamAPIUsage = (token: string, id: string) => request<TeamAPIUsage[]>("GET", `/teams/${id}/api-usage`, token);
