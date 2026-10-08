import { readFileAsDataUrl } from "@/lib/image-utils";
import { uploadMediaFile } from "@/services/file-storage";
import { getStorageObjectInfo } from "../storage";
import { buildApiUrl, localChannelForActiveModel, type AiConfig, type DirectAIProvider } from "@/stores/use-config-store";
import { fetchTeamRequest, resolveTeamRequestURL } from "../team-proxy";
import { fetchAutoDLWorkflow } from "../autodl";
import { asRecord, readString } from "./shared";
import { teamKIEInputConfigs, teamKIEModelAliases } from "./team-kie-config";
import { teamAPIMartImageConfig, teamAPIMartVideoConfig } from "./team-apimart-config";

type Payload = Record<string, unknown>;
type Endpoint = "/images/generations" | "/images/edits" | "/videos" | "/audio/speech";
const list = (value: unknown): string[] => (Array.isArray(value) ? value : value ? [value] : []).map(readString).filter(Boolean);
const bool = (value: unknown) => value === true || value === "true" || value === "1";
const ratio = (value: unknown) => {
    const text = readString(value);
    const dimensions = text.split(/[x:*]/).map(Number);
    if (dimensions.length !== 2 || dimensions.some((n) => !n)) return text;
    const [w, h] = dimensions;
    return ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"].reduce((best, item) => {
        const distance = (r: string) => { const [a, b] = r.split(":").map(Number); return Math.abs(a / b - w / h); };
        return distance(item) < distance(best) ? item : best;
    }, "1:1");
};

// Build native requests locally. Team generation never sends credentials or calls direct-request.
export async function prepareTeamDirectRequest(config: AiConfig, provider: DirectAIProvider, endpoint: Endpoint, source: Payload | FormData) {
    const channel = localChannelForActiveModel(config);
    if (!channel) throw new Error("团队接口已取消开放，请重新选择");
    const base = channel.baseUrl.replace(/\/+$/, "");
    const model = config.model;
    if (provider === "tokendance" && endpoint === "/images/edits" && /gpt-image|dall-e/i.test(model)) {
        const url = `${base.toLowerCase().endsWith("/v1") ? base : `${base}/v1`}${endpoint}`;
        resolveTeamRequestURL(config, url);
        return { provider, url, body: source, contentType: "", protocol: "openai:image-generations", formData: true };
    }
    const payload = await nativePayload(source, provider === "ark" || provider === "tokendance" ? "inline" : "public");
    if (provider === "ark") {
        const url = buildApiUrl(base, endpoint === "/videos" ? "/contents/generations/tasks" : endpoint);
        return { provider, url, body: endpoint === "/videos" ? seedanceBody(payload, model) : payload, contentType: "application/json" };
    }
    if (provider === "kie") {
        const body = kieBody(payload, model);
        // The separate KIE upload host cannot be represented by this channel's baseURL proxy.
        return { provider, url: buildApiUrl(base, body.model === "grok-imagine-image-2-0/text-to-image" ? "/client/tasks" : "/jobs/createTask"), body, contentType: "application/json" };
    }
    if (provider === "apimart") {
        const path = endpoint === "/videos" ? "/videos/generations" : /grok-imagine.*edit/i.test(model) ? endpoint : "/images/generations";
        return { provider, url: buildApiUrl(base, path), body: apimartBody(payload, model, endpoint === "/videos"), contentType: "application/json" };
    }
    if (provider === "autodl") {
        const workflow = await fetchAutoDLWorkflow(base, model, config);
        const rules = workflow.input_rules || {};
        const body: Payload = {};
        for (const [source, target] of Object.entries({ prompt: "prompt", input: "prompt_text", reference_audio: "prompt_simple", first_frame_url: "first_frame", last_frame_url: "last_frame" })) {
            if (rules[target] && payload[source]) body[target] = payload[source];
        }
        for (const [source, prefix] of Object.entries({ "input_reference[]": "ref_image", "audio_reference[]": "ref_audio", "video_reference[]": "ref_video" })) {
            const refs = list(payload[source]);
            const fields = Object.keys(rules).filter((key) => key === prefix || key.startsWith(`${prefix}_`));
            if (refs.length > fields.length) throw new Error(`AutoDL 当前工作流最多支持 ${fields.length} 个参考素材`);
            refs.forEach((value, index) => { body[index === 0 && rules[prefix] ? prefix : `${prefix}_${index}`] = value; });
        }
        for (const field of ["duration", "audio_duration"]) {
            const rule = rules[field];
            if (!rule) continue;
            let seconds = Number(payload.seconds ?? rule.default);
            if (!Number.isFinite(seconds)) throw new Error("AutoDL 时长格式错误");
            if (rule.type === "integer") seconds = Math.floor(seconds);
            body[field] = Math.max(rule.min ?? -Infinity, Math.min(rule.max ?? Infinity, seconds));
        }
        if (rules.resolution) {
            const rule = rules.resolution;
            const quality = readString(payload.resolution_name);
            const target = Number(quality.replace(/p$/i, "").replace(/2k/i, "1440").replace(/4k/i, "2160"));
            const orientation = ratio(payload.size);
            const options = rule.options || [];
            body.resolution = options.find((item) => item.label === quality)?.label || [...options].sort((a, b) => {
                const score = (label: string) => Math.abs(parseFloat(label) - target) + (orientation === "16:9" && !label.includes("横") || orientation === "9:16" && !label.includes("竖") ? 10000 : 0);
                return score(a.label) - score(b.label);
            })[0]?.label || rule.default;
        }
        if (workflow.kind === "audio") body.emo_control_method = rules.emo_control_method?.default;
        for (const [field, rule] of Object.entries(rules)) {
            if (rule.required && field !== "seed" && (!field.startsWith("emo_") || field === "emo_control_method") && (body[field] === undefined || body[field] === "")) throw new Error(`AutoDL 缺少必填参数：${field}`);
        }
        return { provider, url: `${base}/api/v1/comfyui/comfyui_workflow/${encodeURIComponent(model)}`, body, contentType: "application/json" };
    }
    const catalogURL = `${base.toLowerCase().endsWith("/v1") ? base : `${base}/v1`}/models`;
    const response = await fetchTeamRequest(config, catalogURL);
    if (!response.ok) throw new Error("读取 TokenDance 模型协议失败");
    const catalog = await response.json() as { data?: Array<{ id: string; supported_protocols?: string[] }> };
    const supported = catalog.data?.find((item) => item.id.toLowerCase() === model.toLowerCase())?.supported_protocols || [];
    const images = list(payload["input_reference[]"]), videos = list(payload["video_reference[]"]), audios = list(payload["audio_reference[]"]);
    const first = readString(payload.first_frame_url), last = readString(payload.last_frame_url);
    const candidates = endpoint !== "/videos" ? endpoint === "/images/edits" ? ["ark:image-generations", "openai:image-generations"] : ["openai:image-generations", "ark:image-generations"]
        : images.length && videos.length && !audios.length && !first && !last ? ["kling:motion-control", "seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:omni-video"]
        : first && last ? ["seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:image2video"]
        : first || images.length ? ["seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:image2video", "kling:omni-video", "happyhorse:video-synthesis"]
        : audios.length ? ["seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:omni-video"]
        : videos.length ? ["seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:omni-video", "happyhorse:video-synthesis"]
        : ["seedance:generations", "kling:text2video", "kling:omni-video", "wan3:video-synthesis", "happyhorse:video-synthesis", "minimax:video_generation_v2"];
    const protocol = candidates.find((item) => supported.includes(item));
    if (!protocol) throw new Error(`模型 ${model} 不支持当前输入方式`);
    const paths: Record<string, string> = { "ark:image-generations": "/ark/v3/images/generations", "seedance:generations": "/ark/v3/generations/tasks", "kling:text2video": "/kling/v1/text2video", "kling:image2video": "/kling/v1/image2video", "kling:motion-control": "/kling/v1/motion-control", "kling:omni-video": "/kling/v1/omni-video", "wan3:video-synthesis": "/alibaba/wan3/v1/video-synthesis", "happyhorse:video-synthesis": "/alibaba/happyhorse/v1/video-synthesis", "minimax:video_generation_v2": "/minimax/v2/video_generation" };
    const nativeBase = base.replace(/\/v1$/i, "");
    const url = protocol.startsWith("openai:") ? `${base.endsWith("/v1") ? base : `${base}/v1`}${endpoint}` : `${nativeBase}${paths[protocol]}`;
    resolveTeamRequestURL(config, url);
    let body: Payload = payload;
    if (protocol === "seedance:generations") body = { ...seedanceBody(payload, model), ...(first || last ? { ratio: "adaptive" } : {}) };
    else if (protocol === "ark:image-generations") {
        const refs = ["image", "image[]", "images", "input_reference[]"].flatMap((field) => list(payload[field]));
        body = { model, prompt: payload.prompt, response_format: payload.response_format || "url", ...(refs.length ? { image: refs.length === 1 ? refs[0] : refs } : {}) };
        for (const field of ["size", "output_format", "watermark", "seed", "sequential_image_generation", "sequential_image_generation_options", "stream", "tools"]) if (payload[field] !== undefined) body[field] = payload[field];
    } else if (protocol.startsWith("kling:")) {
        const settings: Payload = { resolution: readString(payload.resolution_name).toLowerCase(), duration: Number(payload.seconds), aspect_ratio: ratio(payload.size), ...(payload.video_generate_audio !== undefined ? { audio: bool(payload.video_generate_audio) ? "on" : "off" } : {}) };
        const contents: Payload[] = [{ type: "prompt", text: payload.prompt }];
        if (protocol === "kling:motion-control") {
            if (images[0]) contents.push({ type: "image", url: images[0] });
            if (videos[0]) contents.push({ type: "video", url: videos[0] });
            settings.character_orientation = payload.character_orientation || "video";
        } else {
            let firstFrame = first, lastFrame = last, refs = images;
            if (protocol === "kling:image2video") { firstFrame ||= refs[0]; lastFrame ||= refs[first ? 0 : 1]; refs = []; }
            if (firstFrame) contents.push({ type: "first_frame", url: firstFrame });
            if (lastFrame) contents.push({ type: "last_frame", url: lastFrame });
            contents.push(...refs.map((url) => ({ type: "image", url })), ...videos.map((url) => ({ type: "video", url })), ...audios.map((url) => ({ type: "audio", url })));
        }
        body = { model_name: model, settings, ...(protocol === "kling:text2video" ? { prompt: payload.prompt } : { contents }) };
    } else if (protocol === "wan3:video-synthesis") {
        const media: Payload[] = [...images.map((url) => ({ type: "reference_image", url })), ...videos.map((url) => ({ type: "reference_video", url })), ...audios.map((url) => ({ type: "reference_audio", url }))];
        if (first) media.push({ type: "first_frame", url: first });
        if (last) media.push({ type: "last_frame", url: last });
        body = { model, input: { prompt: payload.prompt, media }, parameters: { resolution: readString(payload.resolution_name).toUpperCase(), duration: Number(payload.seconds), ratio: ratio(payload.size) || "16:9", audio: bool(payload.video_generate_audio), watermark: bool(payload.video_watermark) } };
    } else if (protocol === "happyhorse:video-synthesis") {
        body = { model, input: { prompt: payload.prompt, ...(videos[0] ? { video_url: videos[0] } : images.length > 1 ? { ref_images_url: images } : images[0] || first ? { img_url: images[0] || first } : {}) }, parameters: { resolution: readString(payload.resolution_name).toUpperCase(), duration: Number(payload.seconds), watermark: bool(payload.video_watermark), ...(/-(t2v|r2v)$/.test(model) ? { ratio: ratio(payload.size) === "adaptive" ? "16:9" : ratio(payload.size) || "16:9" } : {}) } };
    } else if (protocol === "minimax:video_generation_v2") {
        const seedance = seedanceBody(payload, model);
        delete seedance.generate_audio; delete seedance.watermark;
        if (first || last) delete seedance.ratio;
        else seedance.ratio ||= "16:9";
        body = { ...seedance, resolution: readString(payload.resolution_name).toUpperCase().replace("720P", "768P") };
    }
    return { provider, url, body, contentType: "application/json", protocol };
}

async function nativePayload(source: Payload | FormData, mode: "inline" | "public"): Promise<Payload> {
    const convert = async (value: unknown): Promise<unknown> => {
        if (value instanceof Blob) {
            const file = value instanceof File ? value : new File([value], "reference", { type: value.type });
            if (mode === "inline" && file.type.startsWith("image/")) return readFileAsDataUrl(file);
            const uploaded = await uploadMediaFile(file, "team-reference");
            if (uploaded.storageKey.startsWith("server:") && !uploaded.storageKey.startsWith("server:webdav:")) {
                const info = await getStorageObjectInfo(uploaded.storageKey.slice(7));
                if (info.publicUrl) return info.publicUrl;
            }
            if (/^https?:\/\//i.test(uploaded.url)) return uploaded.url;
            throw new Error("此渠道的团队参考素材需要可公开访问的云存储地址；专用上传地址暂不支持团队代发");
        }
        if (typeof value === "string" && /^(data:(image|video|audio)\/|blob:)/i.test(value)) return convert(await (await fetch(value)).blob());
        if (Array.isArray(value)) return Promise.all(value.map(convert));
        if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await convert(item)])));
        return value;
    };
    if (!(source instanceof FormData)) return await convert(source) as Payload;
    const result: Payload = {};
    for (const [key, value] of source.entries()) {
        let parsed: unknown = value;
        if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { /* Native text field. */ } }
        const converted = await convert(parsed);
        if (key.endsWith("[]") || result[key] !== undefined) result[key] = [...(Array.isArray(result[key]) ? result[key] as unknown[] : result[key] === undefined ? [] : [result[key]]), converted];
        else result[key] = converted;
    }
    return result;
}

function seedanceBody(payload: Payload, model: string): Payload {
    const content: Payload[] = [{ type: "text", text: payload.prompt }];
    const append = (kind: string, values: string[], role: string) => content.push(...values.map((url) => ({ type: `${kind}_url`, [`${kind}_url`]: { url }, role })));
    append("image", list(payload["input_reference[]"]), "reference_image");
    append("image", list(payload.first_frame_url), "first_frame"); append("image", list(payload.last_frame_url), "last_frame");
    append("video", list(payload["video_reference[]"]), "reference_video"); append("audio", list(payload["audio_reference[]"]), "reference_audio");
    return { model, content, ...(payload.seconds !== undefined ? { duration: Number(payload.seconds) } : {}), ...(payload.size ? { ratio: ratio(payload.size) } : {}), ...(payload.resolution_name ? { resolution: payload.resolution_name } : {}), ...(payload.video_generate_audio !== undefined ? { generate_audio: bool(payload.video_generate_audio) } : {}), ...(payload.video_watermark !== undefined ? { watermark: bool(payload.video_watermark) } : {}) };
}

function kieBody(payload: Payload, selectedModel: string): Payload & { model: string } {
    let model = teamKIEModelAliases[selectedModel.toLowerCase()] || selectedModel;
    if (["grok-imagine", "grok-imagine-video"].includes(model)) model = list(payload["input_reference[]"]).length ? "grok-imagine/image-to-video" : "grok-imagine/text-to-video";
    const config = teamKIEInputConfigs[model.toLowerCase()];
    if (!config) throw new Error("此 KIE 模型尚无团队请求字段映射，请选择已适配模型");
    const input: Payload = { ...asRecord(payload.input) };
    for (const field of ["prompt", "negative_prompt", "mode", "multi_shots", "shot_type", "multi_prompt", "element_list", "character_orientation", "seed", "watermark"]) if (payload[field] !== undefined) input[field] = payload[field];
    if (config.aspectField && payload.size) {
        const aspect = ratio(payload.size);
        const names: Record<string, string> = { "1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9", "4:3": "landscape_4_3", "3:4": "portrait_4_3" };
        input[config.aspectField] = config.aspectKind === "image_size_named" ? names[aspect] || aspect : aspect;
    }
    const motion = model.includes("motion-control");
    if (config.durationKind && payload.seconds !== undefined && !motion) {
        const number = Number(payload.seconds);
        const duration = number === -1 && config.allowAutoDuration ? -1 : Math.max(config.durationMin || -Infinity, Math.min(config.durationMax || Infinity, number));
        input.duration = config.durationKind === "string" ? String(duration) : duration;
    }
    const resolutionField = config.resolutionField || (config.hasResolution ? "resolution" : "");
    if (resolutionField) {
        const value = readString(payload.resolution_name || payload.resolution || payload.image_resolution || payload.quality);
        let resolution = config.resolutionKind === "image" ? /high|4k/i.test(value) ? "4K" : /medium|2k/i.test(value) ? "2K" : "1K" : value.toLowerCase().replace(/^(\d+)$/, "$1p");
        if (config.maxResolution && parseFloat(resolution) > parseFloat(config.maxResolution)) resolution = config.maxResolution;
        if (resolution) input[resolutionField] = resolution;
    }
    if (config.hasQuality) input.quality = model.startsWith("gpt-image/") ? payload.quality === "high" ? "high" : "medium" : payload.quality === "high" ? "high" : "basic";
    if (config.countField && payload.n !== undefined) input[config.countField] = config.countKind === "string" ? String(payload.n) : Number(payload.n);
    if (config.hasOutputFormat && payload.output_format) input.output_format = payload.output_format;
    for (const [kind, field, format] of [["image", config.imageRefField, config.imageRefKind], ["video", config.videoRefField, config.videoRefKind], ["audio", config.audioRefField, config.audioRefKind]]) {
        if (!field) continue;
        const refs = kind === "image" ? ["image", "image[]", "images", "input_reference[]", "first_frame_url"].flatMap((key) => list(payload[key])) : list(payload[`${kind}_reference[]`]);
        if (refs.length) input[field] = format === "single" ? refs[0] : format === "single_array" ? refs.slice(0, 1) : format === "gemini_video_list" ? refs.map((video_url) => ({ video_url })) : refs;
    }
    const namedFrames = /^bytedance\/seedance-2(?:-fast|-mini|-5)?$/.test(model) || model === "wan/2-7-image-to-video";
    if (namedFrames && payload.first_frame_url) input.first_frame_url = payload.first_frame_url;
    if (namedFrames && payload.last_frame_url) input.last_frame_url = payload.last_frame_url;
    else if (payload.last_frame_url && config.imageRefField === "image_url") input[model.includes("hailuo") ? "end_image_url" : "tail_image_url"] = payload.last_frame_url;
    if (model === "kling-3.0/video") {
        if (input.multi_shots !== undefined) input.multi_shots = bool(input.multi_shots);
        if (input.element_list) { input.kling_elements = input.element_list; delete input.element_list; }
    }
    if (motion) input.mode = /1080|pro/i.test(readString(payload.resolution_name)) ? "1080p" : "720p";
    if (payload.video_generate_audio !== undefined) {
        const enabled = bool(payload.video_generate_audio);
        if (model.startsWith("bytedance/seedance")) input.generate_audio = enabled;
        else if (model.startsWith("kling-2.6/")) input.sound = enabled;
        else if (model.startsWith("kling-3.") || model.startsWith("wan/2-6-flash")) input.audio = enabled;
    }
    return { model, input };
}

function apimartBody(payload: Payload, model: string, video: boolean): Payload {
    const config = video ? teamAPIMartVideoConfig(model) : teamAPIMartImageConfig(model);
    const result: Payload = { ...payload, model };
    const modelKey = model.toLowerCase().replace(/[._/ ]/g, "-");
    for (const field of ["size", "ratio", "aspect_ratio", "image_size", "seconds", "resolution_name", "image_resolution", "input_reference[]", "video_reference[]", "audio_reference[]", "image", "image[]", "images", "first_frame_url", "last_frame_url", "actual_image_count", "response_format", "stream", "partial_images", "preset"]) delete result[field];
    if (config.aspectField && payload.size) result[config.aspectField] = ratio(payload.size);
    if (video && !model.includes("motion-control")) result[config.durationField || "duration"] = Number(payload.duration || payload.seconds);
    if (config.hasResolution) {
        const resolution = readString(payload.resolution || payload.resolution_name || payload.image_resolution) || (/high/i.test(readString(payload.quality)) ? "4K" : "1K");
        result.resolution = config.resolutionCase === "video" ? resolution.toLowerCase().replace(/^(\d+)$/, "$1p") : config.resolutionCase === "lower" ? resolution.toLowerCase() : resolution.toUpperCase().replace(/^(\d+)$/, "$1P");
        const ranking = (value: string) => /k$/i.test(value) ? parseFloat(value) * 1000 : parseFloat(value);
        if (config.maxResolution && ranking(String(result.resolution)) > ranking(config.maxResolution)) result.resolution = config.maxResolution;
        if (config.minResolution && ranking(String(result.resolution)) < ranking(config.minResolution)) result.resolution = config.minResolution;
    } else delete result.resolution;
    if (!config.hasOutput) delete result.output_format;
    if (config.modeFromRes) result.mode = /1080|pro/i.test(readString(payload.resolution_name)) ? "pro" : "std";
    if (!config.hasQuality) delete result.quality;
    if (!config.hasCount && !video) delete result.n;
    const images = ["image", "image[]", "images", "input_reference[]"].flatMap((key) => list(payload[key]));
    const first = readString(payload.first_frame_url), last = readString(payload.last_frame_url);
    if (config.imageRefField) {
        const refs = config.maxImageRefs ? images.slice(0, config.maxImageRefs) : images;
        const kind = config.imageRefKind;
        if (kind === "roles" || kind === "seedance2") {
            const roles = [...refs.map((url) => ({ url, role: "reference_image" })), ...(first ? [{ url: first, role: "first_frame" }] : []), ...(last ? [{ url: last, role: "last_frame" }] : [])];
            if (roles.length) result.image_with_roles = roles;
        } else if (kind === "first_last" || kind === "first_only" || kind === "skyreels") {
            if (first || refs[0]) result.first_frame_image = first || refs[0];
            if (kind !== "first_only" && (last || refs[1])) result[kind === "skyreels" ? "end_frame_image" : "last_frame_image"] = last || refs[1];
        } else {
            const frames = [...(first ? [first] : []), ...refs, ...(last ? [last] : [])];
            if (frames.length) result[config.imageRefField] = kind === "single" ? frames[0] : frames;
        }
    }
    for (const [source, field, kind] of [["video_reference[]", config.videoRefField, config.videoRefKind], ["audio_reference[]", config.audioRefField, config.audioRefKind]]) {
        const refs = list(payload[source || ""]);
        if (field && refs.length) result[field] = kind === "single" ? refs[0] : kind === "kling_video_list" ? refs.map((video_url) => ({ video_url })) : refs;
    }
    if (config.dropAspectWithImage && (images.length || first) && config.aspectField) delete result[config.aspectField];
    if (video && payload.video_generate_audio !== undefined) {
        const enabled = bool(payload.video_generate_audio);
        delete result.video_generate_audio;
        if (/seedance-2|veo.*official/.test(modelKey)) result.generate_audio = enabled;
        else if (/seedance-1-5|wan2-6|kling-v3|pixverse-v6|vidu-?q3/.test(modelKey)) result.audio = enabled;
        else if (/kling-(?:v2-6|2-6)/.test(modelKey) && !modelKey.includes("motion") && !last) { result.audio = enabled; if (enabled) result.mode ||= "pro"; }
    }
    if (modelKey === "minimax-h3") result.resolution = /^(480|720|768)p$/i.test(String(result.resolution)) ? "768P" : "2K";
    return result;
}
