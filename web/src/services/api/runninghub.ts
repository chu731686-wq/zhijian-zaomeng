import type { WorkflowCapability, WorkflowEntry, WorkflowKind } from "@/lib/workflow-channel";
import type { AdminModelChannel } from "@/services/api/admin";
import { apiPost } from "@/services/api/request";

export type RunningHubInspectInput = {
    baseUrl: string;
    apiKey: string;
    kind: WorkflowKind;
    workflowId: string;
    title: string;
    capability: WorkflowCapability;
};

export function inspectRunningHub(token: string, input: RunningHubInspectInput, admin?: { index?: number; channel: AdminModelChannel }) {
    return admin
        ? apiPost<WorkflowEntry>("/api/admin/workflow-providers/runninghub/inspect", { ...admin, input }, token)
        : apiPost<WorkflowEntry>("/api/v1/workflow-providers/runninghub/inspect", input, token);
}
