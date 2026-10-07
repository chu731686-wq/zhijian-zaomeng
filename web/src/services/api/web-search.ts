import { apiGet, apiPost } from "./request";

export type WebSearchSettings = { provider: "bing" | "bocha"; apiKey: string; configured: boolean };
export type WebSearchSettingsInput = { provider: "bing" | "bocha"; apiKey?: string };
export type WebSearchRequest = { query: string; provider?: "toutiao" | "bing" | "bocha"; time_range?: string; include_domains?: string[]; max_results?: number };
export type WebSearchResponse = {
    provider: string; query: string; time_range: string; warnings: string[];
    results: Array<{ title: string; url: string; domain: string; snippet: string; content: string; published_at: string }>;
};
export type WebFetchResponse = { url: string; title: string; content: string; truncated: boolean; fetched_at: string };

export const fetchWebSearchSettings = (token: string) => apiGet<WebSearchSettings>("/api/v1/web-search/settings", undefined, token);
export const saveWebSearchSettings = (token: string, settings: WebSearchSettingsInput) => apiPost<WebSearchSettings>("/api/v1/web-search/settings", settings, token);
export const testWebSearchSettings = (token: string, settings: WebSearchSettingsInput) => apiPost<{ connected: boolean }>("/api/v1/web-search/test", settings, token);
export const searchWeb = (token: string | undefined, request: WebSearchRequest, signal?: AbortSignal) => apiPost<WebSearchResponse>("/api/v1/web-search", request, token, signal);
export const fetchWeb = (token: string | undefined, request: { url: string; max_chars?: number }, signal?: AbortSignal) => apiPost<WebFetchResponse>("/api/v1/web-fetch", request, token, signal);
