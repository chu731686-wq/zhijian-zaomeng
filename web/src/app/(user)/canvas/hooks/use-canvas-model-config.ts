"use client";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useEffectiveConfig, type LocalModelChannel } from "@/stores/use-config-store";
import { useTeamModelStore } from "@/stores/use-team-model-store";
import { TEAM_PROXY_ORIGIN } from "@/services/api/team-proxy";
import { isWorkflowProtocol } from "@/lib/model-channel";

export function useCanvasModelConfig() {
    const config = useEffectiveConfig();
    const params = useParams<{ id: string }>();
    const team = useTeamModelStore();
    return useMemo(() => {
        if (!team.teamId || team.canvasId !== params.id) return config;
        const teamChannels: LocalModelChannel[] = team.channels.filter((channel) => channel.can_use && !isWorkflowProtocol(channel.protocol)).map((channel) => ({
            ...channel, id: `team:${channel.channel_id}`, name: channel.name,
            protocol: channel.protocol || "openai", baseUrl: `${TEAM_PROXY_ORIGIN}${channel.base_path || ""}`,
            apiKey: "", models: channel.models.map((model) => model.id),
        }));
        return { ...config, teamContext: { canvasId: team.canvasId, teamId: team.teamId, teamName: team.teamName }, teamChannels,
            models: [...new Set([...config.models, ...teamChannels.flatMap((channel) => channel.models)])] };
    }, [config, params.id, team]);
}
