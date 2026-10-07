import type { WorkflowCapability, WorkflowFieldMapping, WorkflowGraphPreview } from "@/lib/workflow-channel";
import { apiDelete, apiGet, apiPost } from "@/services/api/request";

export type ComfyBridgeSummary = {
    id: string;
    name: string;
    enabled: boolean;
    online: boolean;
    lastSeenAt?: string;
    capabilities?: {
        comfyOnline?: boolean;
        comfyUrl?: string;
        workflowDir?: string;
        workflows?: Array<{ workflowId: string; title?: string }>;
    };
};

export type ComfyBridgeRegistration = { bridge: ComfyBridgeSummary; token: string };
export type ComfyBridgeInspectInput = { bridgeId: string; workflowId: string; workflowJson?: Record<string, unknown>; capability: WorkflowCapability };
export type ComfyBridgeInspectResult = { workflowJson: Record<string, unknown>; workflowGraph?: WorkflowGraphPreview; fields: WorkflowFieldMapping[] };

const bridgePath = (admin: boolean) => admin ? "/api/admin/comfy-bridges" : "/api/v1/comfy-bridges";

export function listComfyBridges(token: string, admin = false) {
    return apiGet<ComfyBridgeSummary[]>(bridgePath(admin), undefined, token);
}

export function createComfyBridge(token: string, name: string, admin = false) {
    return apiPost<ComfyBridgeRegistration>(bridgePath(admin), { name }, token);
}

export function deleteComfyBridge(token: string, id: string, admin = false) {
    return apiDelete<{ deleted: boolean }>(`${bridgePath(admin)}/${encodeURIComponent(id)}`, token);
}

export function inspectComfyBridge(token: string, input: ComfyBridgeInspectInput, admin = false) {
    return apiPost<ComfyBridgeInspectResult>(`${bridgePath(admin)}/inspect`, input, token);
}
