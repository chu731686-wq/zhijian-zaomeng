import type { WorkflowFieldMapping } from "@/lib/workflow-channel";

const ratioOptions = ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "3:2", "2:3", "21:9", "9:21"];
const resolutionAspectRatios = ["1:1 (Square)", "2:3 (Portrait Photo)", "3:2 (Photo)", "3:4 (Portrait Standard)", "4:3 (Standard)", "9:16 (Portrait Widescreen)", "16:9 (Widescreen)", "21:9 (Ultrawide)"];
const presetOptions: Record<string, string[]> = {
    aspectratio: ratioOptions, ratio: ratioOptions,
    resolution: ["512", "768", "1024", "1280", "1536", "2048", "1k", "2k", "4k"],
    sampler: ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpmpp_2m", "dpmpp_sde", "ddim", "uni_pc"],
    samplername: ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpmpp_2m", "dpmpp_sde", "ddim", "uni_pc"],
    scheduler: ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"],
};

function isRange(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    const sources = [item, item.range && typeof item.range === "object" && !Array.isArray(item.range) ? item.range as Record<string, unknown> : {}];
    return sources.some((source) => ["min", "max", "step", "minValue", "maxValue", "stepValue"].some((key) => source[key] !== undefined));
}

export function workflowFieldNumberBounds(field?: WorkflowFieldMapping) {
    if (!field) return {};
    const sources = [field as Record<string, unknown>, ...(field.options || []).filter(isRange).flatMap((item) => {
        const option = item as Record<string, unknown>;
        return [option, option.range && typeof option.range === "object" ? option.range as Record<string, unknown> : {}];
    })];
    const read = (keys: string[]) => {
        for (const source of sources) for (const key of keys) {
            const value = source[key];
            if (value !== undefined && value !== null && String(value).trim() && Number.isFinite(Number(value))) return Number(value);
        }
        return undefined;
    };
    return { min: read(["min", "minValue", "min_value"]), max: read(["max", "maxValue", "max_value"]), step: read(["step", "stepValue", "step_value"]) };
}

export function workflowFieldChoiceValues(field?: WorkflowFieldMapping): unknown[] {
    if (!field) return [];
    const bounds = workflowFieldNumberBounds(field);
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.step !== undefined) return [];
    const choices = (field.options || []).filter((option) => !isRange(option));
    if (choices.length) return choices;
    return String(field.classType || "").toLowerCase().replace(/[\s_-]/g, "") === "resolutionselector" && String(field.fieldName || "").toLowerCase().replace(/[\s_-]/g, "") === "aspectratio" ? resolutionAspectRatios : [];
}

export function workflowOptionValue(value: unknown): string | number {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const option = value as Record<string, unknown>;
        for (const key of ["value", "id", "key", "name", "label"]) {
            if (option[key] !== undefined && option[key] !== null) return typeof option[key] === "number" ? option[key] as number : String(option[key]);
        }
    }
    return typeof value === "number" ? value : String(value ?? "");
}

export function workflowOptionText(value: unknown) {
    return String(workflowOptionValue(value));
}

export function workflowFieldPresetOptions(field?: WorkflowFieldMapping): string[] {
    if (!field || ["NUMBER", "FLOAT", "INTEGER", "INT", "SLIDER", "BOOLEAN", "BOOL", "IMAGE", "VIDEO", "AUDIO"].includes(String(field.fieldType || "").toUpperCase())) return [];
    const key = String(field.fieldName || "").toLowerCase().replace(/[\s_-]/g, "");
    if (String(field.classType || "").toLowerCase().replace(/[\s_-]/g, "") === "resolutionselector" && key === "aspectratio") return resolutionAspectRatios;
    return presetOptions[key] || [];
}

export function workflowFieldConfigurationError(field: WorkflowFieldMapping) {
    const bounds = workflowFieldNumberBounds(field);
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) return "最小值不能大于最大值";
    if (bounds.step !== undefined && bounds.step <= 0) return "步长必须大于 0";
    return "";
}
