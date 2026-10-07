export function readDirectError(payload: unknown) {
    const code = readNumber(readPath(payload, "code"));
    const explicitError = firstString(readPath(payload, "error.message"), readPath(payload, "data.error.message"), readPath(payload, "data.failMsg"), readPath(payload, "data.failCode"));
    if (explicitError) return explicitError;
    if (code !== undefined && code !== 0 && code !== 200) return firstString(readPath(payload, "msg"), readPath(payload, "message"), `上游请求失败：${code}`);
    return "";
}

export function normalizeDirectStatus(value: string) {
    switch (value.trim().toLowerCase()) {
        case "success":
        case "succeeded":
        case "completed":
            return "completed";
        case "fail":
        case "failed":
        case "cancelled":
        case "canceled":
            return "failed";
        default:
            return "processing";
    }
}

export function collectHTTPURLs(value: unknown, depth = 0): string[] {
    if (value === null || value === undefined || depth > 8) return [];
    if (typeof value === "string") {
        const text = value.trim();
        if (/^https?:\/\//i.test(text)) return [text];
        const parsed = parseJSONValue(text);
        return parsed === text ? [] : collectHTTPURLs(parsed, depth + 1);
    }
    if (Array.isArray(value)) return value.flatMap((item) => collectHTTPURLs(item, depth + 1));
    if (isPlainRecord(value)) return Object.values(value).flatMap((item) => collectHTTPURLs(item, depth + 1));
    return [];
}

export function firstHTTPURL(value: unknown) {
    return uniqueHTTPURLs(collectHTTPURLs(value))[0] || "";
}

export function uniqueHTTPURLs(values: string[]) {
    return [...new Set(values.filter((value) => /^https?:\/\//i.test(value)))];
}

export function parseJSONValue(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text || !["{", "["].includes(text[0])) return value;
    try {
        return JSON.parse(text);
    } catch {
        return value;
    }
}

export function readPath(value: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((current, key) => {
        if (Array.isArray(current)) return current[Number(key)];
        return isPlainRecord(current) ? current[key] : undefined;
    }, value);
}

export function asRecord(value: unknown): Record<string, unknown> {
    return isPlainRecord(value) ? value : {};
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

export function readString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

export function readNumber(value: unknown) {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : undefined;
}

export function firstString(...values: unknown[]) {
    for (const value of values) {
        const text = readString(value);
        if (text) return text;
    }
    return "";
}
