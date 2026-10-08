"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { autoDLBaseUrl, isAutoDLConfig } from "@/lib/autodl";
import { fetchAutoDLWorkflow, fetchAutoDLWorkflows } from "@/services/api/autodl";
import type { AiConfig } from "@/stores/use-config-store";

export function useAutoDLWorkflow(config: AiConfig, model = config.model) {
    const baseUrl = autoDLBaseUrl(config, model);
    const enabled = isAutoDLConfig(config, model) && Boolean(model);
    return useQuery({
        queryKey: ["autodl", enabled ? baseUrl : "", model, config.teamContext?.teamId, config.teamContext?.canvasId, config.activeChannelId],
        queryFn: () => fetchAutoDLWorkflow(baseUrl, model, config),
        enabled,
        staleTime: 300_000,
    });
}

type AutoDLChannel = { protocol?: string; baseUrl?: string };

export function useAutoDLWorkflowNames(channels: AutoDLChannel[]) {
    const baseUrls = [...new Set(channels.filter((channel) => channel.protocol === "autodl" && !channel.baseUrl?.startsWith("https://team-proxy.invalid")).map((channel) => (channel.baseUrl || "https://autodl.art").trim().replace(/\/+$/, "")))];
    const queries = useQueries({ queries: baseUrls.map((baseUrl) => ({
        queryKey: ["autodl", baseUrl, "workflows"],
        queryFn: () => fetchAutoDLWorkflows(baseUrl),
        staleTime: 300_000,
    })) });
    return (model: string, channel?: AutoDLChannel | null) => {
        if (channel?.protocol !== "autodl") return model;
        const baseUrl = (channel.baseUrl || "https://autodl.art").trim().replace(/\/+$/, "");
        return queries[baseUrls.indexOf(baseUrl)]?.data?.find((workflow) => workflow.uuid === model)?.name || model;
    };
}
