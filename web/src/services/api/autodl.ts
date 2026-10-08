import type { AiConfig } from "@/stores/use-config-store";
import { isTeamConfig, fetchTeamRequest } from "./team-proxy";
import { apiPost } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";

export type AutoDLInputRule = {
    type: string;
    options?: Array<{ label: string }>;
    required?: boolean;
    default?: string | number;
    min?: number;
    max?: number;
};

export type AutoDLWorkflow = {
    uuid: string;
    name: string;
    kind: "video" | "audio" | "unsupported";
    input_rules?: Record<string, AutoDLInputRule>;
};

export function fetchAutoDLWorkflows(baseUrl: string) {
    return apiPost<AutoDLWorkflow[]>("/api/ai/autodl/workflows", { baseUrl }, useUserStore.getState().token);
}

export async function fetchAutoDLWorkflow(baseUrl: string, workflowId: string, config?: AiConfig) {
    if (config && isTeamConfig(config)) {
        const response = await fetchTeamRequest(config, `${baseUrl.replace(/\/+$/, "")}/api/v1/comfyui/workflows/${encodeURIComponent(workflowId)}`);
        const result = await response.json() as { code: string | number; data: AutoDLWorkflow; msg?: string };
        if (!response.ok || String(result.code).toLowerCase() !== "success" && result.code !== 0) throw new Error(result.msg || "AutoDL 工作流详情读取失败");
        return result.data;
    }
    return apiPost<AutoDLWorkflow>("/api/ai/autodl/workflows", { baseUrl, workflowId }, useUserStore.getState().token);
}
