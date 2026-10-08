import { channelIdForActiveModel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useTeamModelStore } from "@/stores/use-team-model-store";

export const TEAM_PROXY_ORIGIN = "https://team-proxy.invalid";
export const isTeamChannelId = (id?: string) => Boolean(id?.startsWith("team:"));
export function selectedTeamChannelId(config: AiConfig) {
    const id = channelIdForActiveModel(config);
    return isTeamChannelId(id) ? id : "";
}
export function isTeamConfig(config: AiConfig) { return Boolean(selectedTeamChannelId(config)); }
export function teamRequestHeaders(contentType?: string) {
    const token = useUserStore.getState().token;
    if (!token) throw new Error("请先登录后再使用团队接口");
    return { Authorization: `Bearer ${token}`, ...(contentType ? { "Content-Type": contentType } : {}) };
}
export function teamProxyBase(config: AiConfig) {
    const context = config.teamContext;
    const id = selectedTeamChannelId(config);
    const live = useTeamModelStore.getState();
    if (!context || !id || live.canvasId !== context.canvasId || live.teamId !== context.teamId || !live.channels.some((channel) => `team:${channel.channel_id}` === id && channel.can_use)) throw new Error("此团队接口已取消开放或你已无权使用，请重新选择模型");
    return `/api/v1/teams/${encodeURIComponent(context.teamId)}/proxy/${encodeURIComponent(id.slice(5))}`;
}
export function resolveTeamRequestURL(config: AiConfig, value: string) {
    if (!isTeamConfig(config)) return value;
    const proxy = teamProxyBase(config);
    if (value.startsWith(`${proxy}/`)) {
        const target = new URL(value, TEAM_PROXY_ORIGIN);
        target.searchParams.set("canvas_id", config.teamContext!.canvasId);
        return `${target.pathname}?${target.searchParams}`;
    }
    const target = new URL(value);
    if (target.origin !== TEAM_PROXY_ORIGIN) throw new Error("此接口的请求地址暂不支持团队代发");
    const channel = config.teamChannels?.find((item) => item.id === selectedTeamChannelId(config));
    const prefix = new URL(channel?.baseUrl || TEAM_PROXY_ORIGIN).pathname.replace(/\/+$/, "");
    // A native protocol that removes a configured path cannot be represented by the backend's baseURL + path proxy.
    if (prefix && target.pathname !== prefix && !target.pathname.startsWith(`${prefix}/`)) throw new Error("此接口会改写基础路径，暂不支持团队代发；请队长配置不含版本后缀的接口地址");
    for (const name of [...target.searchParams.keys()]) if (/key|secret|token/i.test(name)) target.searchParams.delete(name);
    target.searchParams.set("canvas_id", config.teamContext!.canvasId);
    return `${proxy}/${target.pathname.slice(prefix.length).replace(/^\/+/, "")}?${target.searchParams}`;
}
export function isTeamProxyURL(url: string) { return url.startsWith("/api/v1/teams/") && url.includes("/proxy/"); }
export function fetchTeamRequest(config: AiConfig, url: string, init?: RequestInit) {
    if (!isTeamConfig(config)) return fetch(url, init);
    const headers = new Headers(init?.headers);
    for (const name of [...headers.keys()]) {
        if (/authorization|api[-_]?key|secret|token/i.test(name)) headers.delete(name);
    }
    Object.entries(teamRequestHeaders()).forEach(([name, value]) => headers.set(name, value));
    return fetch(resolveTeamRequestURL(config, url), { ...init, headers });
}
export function teamProtectedMediaURL(config: AiConfig, value: string) {
    if (!isTeamConfig(config)) return value;
    const url = new URL(value);
    url.searchParams.delete("key");
    return resolveTeamRequestURL(config, `${TEAM_PROXY_ORIGIN}${url.pathname}${url.search}`);
}
