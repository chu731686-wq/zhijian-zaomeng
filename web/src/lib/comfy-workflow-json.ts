import type { WorkflowGraphPreview } from "@/lib/workflow-channel";

type JsonObject = Record<string, unknown>;
const record = (value: unknown): JsonObject | null => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const note = (value: string) => ["note", "markdownnote", "label", "addlabel", "label (rgthree)", "fast groups bypasser", "fast groups bypasser (rgthree)"].includes(value.toLowerCase());

export function parseComfyWorkflowJSON(value: unknown): { workflowJson: JsonObject; workflowGraph?: WorkflowGraphPreview } {
    const parsed = record(value);
    if (!parsed) throw new Error("ComfyUI JSON 必须是对象");
    if (!Array.isArray(parsed.nodes)) {
        const nodes = Object.entries(parsed).filter(([, raw]) => Boolean(record(raw)?.class_type && record(record(raw)?.inputs)));
        if (!nodes.length) throw new Error("未找到可执行的 ComfyUI API 节点");
        return { workflowJson: Object.fromEntries(nodes.filter(([, raw]) => !note(String(record(raw)?.class_type || "")))) };
    }

    const links = new Map((Array.isArray(parsed.links) ? parsed.links : []).filter(Array.isArray).map((item) => [String(item[0]), item as unknown[]]));
    const workflowJson: JsonObject = {};
    const graphNodes: WorkflowGraphPreview["nodes"] = [];
    const graphEdges: WorkflowGraphPreview["edges"] = [];
    for (const raw of parsed.nodes) {
        const node = record(raw);
        if (!node) continue;
        const id = String(node.id ?? "").trim();
        const classType = String(node.type || node.class_type || "").trim();
        if (!id || !classType || note(classType)) continue;
        const inputs: JsonObject = {};
        const named = record(node.widgets_values_named) || {};
        const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
        let valueIndex = 0;
        for (const rawInput of Array.isArray(node.inputs) ? node.inputs : []) {
            const input = record(rawInput);
            const name = String(input?.name || "").trim();
            if (!name) continue;
            const link = input?.link == null ? null : links.get(String(input.link));
            if (link) {
                inputs[name] = [String(link[1]), Number(link[2]) || 0];
                graphEdges.push({ from: String(link[1]), to: id });
                continue;
            }
            const widget = record(input?.widget);
            const widgetName = String(widget?.name || name);
            if (widgetName in named) { inputs[name] = named[widgetName]; valueIndex++; }
            else if (widget && valueIndex < values.length) inputs[name] = values[valueIndex++];
        }
        const title = String(node.title || record(node.properties)?.["Node name for S&R"] || classType);
        workflowJson[id] = { class_type: classType, inputs, _meta: { title } };
        graphNodes.push({ id, title, classType });
    }
    if (!graphNodes.length) throw new Error("ComfyUI 画布 JSON 没有可执行节点");
    return { workflowJson, workflowGraph: { nodes: graphNodes, edges: graphEdges } };
}
