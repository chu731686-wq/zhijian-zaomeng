import { modelKey } from "@/lib/video-model-capabilities";
import { channelIdForActiveModel, channelProtocolForConfig, localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";

export type DurationCapability = { min?: number; max?: number; step?: number; values?: number[] };
export type ModelCapability = {
    kind: "video" | "image";
    name: string;
    pattern: RegExp;
    provider?: string;
    ratios: string[];
    resolutions: string[];
    duration?: DurationCapability;
    durationByResolution?: Record<string, DurationCapability>;
    ratiosByResolution?: Record<string, string[]>;
    pixelSizes?: Record<string, string>;
    pixelAlignment?: number;
    maxImagePixels?: number;
    sources: string[];
    notes?: string;
};

// Native tiers are recorded verbatim; panels only show the task's permitted tiers.
export const modelCapabilitiesTable: ModelCapability[] = [
    {"kind": "video", "name": "可灵 AI Avatar（Standard / Pro）", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "duration": {"min": 4, "max": 15, "step": 1}, "sources": [], "notes": "未查到可配置输出规格；使用任务卡默认。输出可能随输入，生成调用保持原状。", "pattern": /kling-ai-avatar/i },
    {"kind": "video", "name": "Topaz Video Upscale", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "duration": {"min": 4, "max": 15, "step": 1}, "sources": [], "notes": "未查到可配置输出规格；使用任务卡默认。输出可能随输入，生成调用保持原状。", "pattern": /topaz-video-upscale/i },
    {"kind": "video", "name": "Grok Upscale / Extend", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "duration": {"min": 4, "max": 15, "step": 1}, "sources": [], "notes": "未查到可配置输出规格；使用任务卡默认。输出可能随输入，生成调用保持原状。", "pattern": /grok-imagine-(?:upscale|extend)/i },
    {"kind": "image", "name": "Seedream 5.0 Flash", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "2:1", "1:2", "adaptive"], "resolutions": ["1K", "2K"], "sources": ["https://docs.apimart.ai/en/api-reference/images/seedream-5-0-flash/generation"], "notes": "原生另支持 1.5K；不支持 4K。", "pattern": /seedream-5.*flash/i },
    {"kind": "video", "name": "Vidu Q3 Mix", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["720P", "1080P"], "duration": {"min": 1, "max": 16, "step": 1}, "sources": ["https://docs.apimart.ai/en/api-reference/videos/vidu-q3/generation"], "pattern": /vidu-?q3.*mix/i },
    {"kind": "video", "name": "Seedance 1.0 Lite（KIE V1）", "provider": "kie", "ratios": ["16:9", "4:3", "1:1", "3:4", "9:16", "9:21"], "resolutions": ["480P", "720P", "1080P"], "duration": {"values": [5, 10]}, "sources": ["https://docs.kie.ai/market/bytedance/v1-lite-text-to-video"], "notes": "接口枚举包括 9:21；项目现有归一化会约为 3:7，面板隐藏该比例。", "pattern": /bytedance-v1-lite-text-to-video/i },
    {"kind": "image", "name": "CogView", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["1K", "2K"], "sources": ["https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%9B%BE%E5%83%8F%E7%94%9F%E6%88%90"], "pixelAlignment": 16, "maxImagePixels": 2097152, "notes": "宽高 512–2048、16 倍数、总像素不超 2^21；2K 是界面档位，实际尺寸受总像素上限约束。", "pattern": /cogview/i },
    {"kind": "video", "name": "Seedance 1.0 Pro/Lite（KIE V1）", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.kie.ai/market/bytedance/v1-pro-text-to-video"], "provider": "kie", "notes": "Lite 文生视频宽幅枚举为 9:21；KIE Pro 为 21:9。", "duration": {"values": [5, 10]}, "pattern": /bytedance-v1-pro/i },
    {"kind": "video", "name": "Seedance 1.0 Pro / Pro Fast", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.volcengine.com/docs/82379/1520757"], "duration": {"min": 2, "max": 12, "step": 1}, "pattern": /seedance-1-0(?!.*lite)|seedance-1-pro/i },
    {"kind": "video", "name": "Seedance 1.0 Lite / Bytedance V1", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.kie.ai/market/bytedance/v1-pro-text-to-video"], "duration": {"values": [5, 10]}, "notes": "官方 Lite 未查到完整规格；Bytedance V1 采用 KIE 接口枚举。", "pattern": /bytedance-v1|seedance-1-0-lite/i },
    {"kind": "video", "name": "Seedance 1.5 Pro", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/seedance-1-5-pro/generation"], "duration": {"min": 4, "max": 12, "step": 1}, "pattern": /seedance-1-5/i },
    {"kind": "video", "name": "Seedance 2.0 Fast / Mini", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], "resolutions": ["480P", "720P"], "sources": ["https://docs.volcengine.com/docs/82379/1520757"], "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /seedance-(?:2-0|2)(?:-fast|-mini)|seedance-2-0.*(?:fast|mini)/i },
    {"kind": "video", "name": "Seedance 2.5 / SD2.5", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.volcengine.com/docs/82379/1520757"], "notes": "官方另支持 -1 智能时长；编辑必须 -1、编辑/延长/首尾帧仅 adaptive。面板秒数仅列固定长度生成值。", "duration": {"min": 4, "max": 30, "step": 1}, "pattern": /seedance-2-5|sd2-5/i },
    {"kind": "video", "name": "Seedance 2.0 / SD2.0", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], "resolutions": ["480P", "720P", "1080P", "4K"], "sources": ["https://docs.volcengine.com/docs/82379/1520757"], "notes": "正式版支持 4K；fast/mini 不支持。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /seedance-2-0|bytedance-seedance-2$|sd2-0/i },
    {"kind": "video", "name": "可灵 2.1 / 2.5 专业版", "ratios": ["16:9", "9:16", "1:1"], "resolutions": ["1080P"], "sources": ["https://kling.ai/document-api/guides/capability-map/video"], "duration": {"values": [5, 10]}, "pattern": /kling-(?:v?2-1|v?2-5).*(?:pro|master)/i },
    {"kind": "video", "name": "可灵 2.x / 2.6", "ratios": ["16:9", "9:16", "1:1"], "resolutions": ["720P", "1080P"], "sources": ["https://kling.ai/document-api/guides/capability-map/video"], "duration": {"values": [5, 10]}, "pattern": /kling-(?:v?2(?:-|$)|(?:text|image)-to-video)/i },
    {"kind": "video", "name": "可灵 3.0 Turbo", "ratios": ["16:9", "9:16", "1:1"], "resolutions": ["720P", "1080P"], "sources": ["https://kling.ai/document-api/guides/capability-map/video"], "duration": {"min": 3, "max": 15, "step": 1}, "pattern": /kling-(?:v?3|3-0).*turbo/i },
    {"kind": "video", "name": "可灵 V3 / 3.0 / Omni", "ratios": ["16:9", "9:16", "1:1"], "resolutions": ["720P", "1080P", "4K"], "sources": ["https://kling.ai/document-api/guides/capability-map/video"], "duration": {"min": 3, "max": 15, "step": 1}, "pattern": /kling-(?:v3|3-0)/i },
    {"kind": "video", "name": "可灵 O1（APIMart）", "ratios": ["16:9", "9:16", "1:1"], "resolutions": ["720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/kling-video-o1/generation"], "provider": "apimart", "duration": {"values": [5, 10]}, "pattern": /kling-(?:video-)?o1/i },
    {"kind": "video", "name": "可灵 O1", "ratios": ["16:9", "9:16", "1:1"], "resolutions": ["720P", "1080P"], "sources": ["https://kling.ai/document-api/api/video/o1/video-omni/legacy"], "notes": "视频编辑长度随输入，不能指定。", "duration": {"min": 3, "max": 10, "step": 1}, "pattern": /kling-(?:video-)?o1/i },
    {"kind": "video", "name": "Veo 3 / 3.1（APIMart）", "ratios": ["16:9", "9:16"], "resolutions": ["720P", "1080P", "4K"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/veo3/generation"], "provider": "apimart", "duration": {"values": [8]}, "pattern": /veo/i },
    {"kind": "video", "name": "Veo 3.1 Lite", "ratios": ["16:9", "9:16"], "resolutions": ["720P", "1080P"], "sources": ["https://ai.google.dev/gemini-api/docs/veo"], "durationByResolution": {"1080P": {"values": [8]}}, "duration": {"values": [4, 6, 8]}, "pattern": /veo-?3-1.*lite/i },
    {"kind": "video", "name": "Veo 3.1 / Fast", "ratios": ["16:9", "9:16"], "resolutions": ["720P", "1080P", "4K"], "sources": ["https://ai.google.dev/gemini-api/docs/veo"], "durationByResolution": {"1080P": {"values": [8]}, "4K": {"values": [8]}}, "duration": {"values": [4, 6, 8]}, "pattern": /veo-?3-1/i },
    {"kind": "video", "name": "Veo 3 / Fast", "ratios": ["16:9", "9:16"], "resolutions": ["720P", "1080P"], "sources": ["https://ai.google.dev/gemini-api/docs/veo"], "notes": "官方功能表记 8 秒；1080P 限 16:9。", "ratiosByResolution": {"1080P": ["16:9"]}, "duration": {"values": [8]}, "pattern": /veo-?3/i },
    {"kind": "video", "name": "Sora 2 / Pro", "ratios": ["16:9", "9:16"], "resolutions": ["720P"], "sources": ["https://developers.openai.com/api/reference/resources/videos/methods/create"], "notes": "Pro 额外 1792×1024 / 1024×1792 非 1080P，按任务卡按钮范围不列。；官方页面标注 API 已计划于 2026-09-24 关闭，此处记录原接口规格，中转可用性需看通道。", "duration": {"values": [4, 8, 12]}, "pattern": /sora-2/i },
    {"kind": "video", "name": "海螺 02（APIMart 别名）", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["512P", "768P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/minimax-hailuo/generation"], "durationByResolution": {"1080P": {"values": [5]}}, "notes": "比例未查到，使用默认视频比例；平台秒数不同于 KIE 的 6/10。", "duration": {"values": [5, 10]}, "pattern": /minimax-hailuo-02/i },
    {"kind": "video", "name": "海螺 02 / 2.3 Pro（KIE）", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["1080P"], "sources": ["https://docs.kie.ai/market/hailuo/02-text-to-video-pro"], "notes": "输出跟随参考图；比例未查到，使用默认视频比例。", "duration": {"values": [6]}, "pattern": /hailuo-?(?:02|2-3).*pro/i },
    {"kind": "video", "name": "海螺 02 / 2.3 Standard（KIE）", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["768P"], "sources": ["https://docs.kie.ai/market/hailuo/02-text-to-video-standard"], "notes": "比例未查到，使用默认视频比例；768P 不伪装为 720P。", "duration": {"values": [6, 10]}, "pattern": /hailuo-?(?:02|2-3).*standard/i },
    {"kind": "video", "name": "海螺 2.3", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["768P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/minimax-hailuo-2.3/generation"], "durationByResolution": {"1080P": {"values": [6]}}, "notes": "比例未查到，使用默认视频比例。", "duration": {"values": [6, 10]}, "pattern": /hailuo-2-3/i },
    {"kind": "video", "name": "MiniMax H3 Max", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], "resolutions": ["480P", "768P"], "sources": ["https://platform.minimax.io/docs/api-reference/video-generation-v2-create"], "duration": {"min": 5, "max": 15, "step": 1}, "pattern": /minimax-h3-max/i },
    {"kind": "video", "name": "MiniMax H3 / AutoDL H3 别名", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], "resolutions": ["768P", "2K"], "sources": ["https://platform.minimax.io/docs/api-reference/video-generation-v2-create"], "notes": "AutoDL 最终秒数以工作流返回的 input_rules 为准。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /minimax-h3/i },
    {"kind": "video", "name": "Vidu Q3 Pro / Turbo", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["540P", "720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/vidu-q3-pro/generation"], "duration": {"min": 1, "max": 16, "step": 1}, "pattern": /vidu-?q3.*(?:pro|turbo)/i },
    {"kind": "video", "name": "Vidu Q3 Standard", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["540P", "720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/vidu-q3/generation"], "duration": {"min": 3, "max": 16, "step": 1}, "pattern": /vidu-?q3/i },
    {"kind": "video", "name": "万相 Wan 3.0", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "adaptive"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/wan3.0-video/generation"], "notes": "另支持 -1 智能时长。", "duration": {"min": 2, "max": 30, "step": 1}, "pattern": /wan-?3-0/i },
    {"kind": "video", "name": "万相 Wan 2.7", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["720P", "1080P"], "sources": ["https://www.alibabacloud.com/help/en/model-studio/use-video-generation/"], "duration": {"min": 2, "max": 15, "step": 1}, "pattern": /wan-?2-7/i },
    {"kind": "video", "name": "万相 Wan 2.6", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/wan2.6/generation"], "duration": {"values": [5, 10, 15]}, "pattern": /wan-?2-6/i },
    {"kind": "video", "name": "万相 Wan 2.5", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/wan2.5/generation"], "ratiosByResolution": {"480P": ["16:9", "9:16", "1:1"]}, "duration": {"values": [5, 10]}, "pattern": /wan-?2-5/i },
    {"kind": "video", "name": "Grok 视频（KIE）", "ratios": ["16:9", "9:16", "1:1", "3:2", "2:3"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.kie.ai/market/grok-imagine/text-to-video"], "provider": "kie", "duration": {"min": 6, "max": 30, "step": 1}, "pattern": /grok-imagine/i },
    {"kind": "video", "name": "Grok 视频（APIMart）", "ratios": ["16:9", "9:16", "1:1", "3:2", "2:3"], "resolutions": ["480P", "720P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/grok-imagine/generation"], "provider": "apimart", "duration": {"min": 6, "max": 15, "step": 1}, "pattern": /grok-imagine/i },
    {"kind": "video", "name": "Grok Imagine Video 1.5", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.x.ai/developers/model-capabilities/video/generation"], "duration": {"min": 1, "max": 15, "step": 1}, "pattern": /grok-imagine-video-1-5/i },
    {"kind": "video", "name": "Grok Imagine Video", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"], "resolutions": ["480P", "720P"], "sources": ["https://docs.x.ai/developers/model-capabilities/video/generation"], "duration": {"min": 1, "max": 15, "step": 1}, "pattern": /grok-imagine/i },
    {"kind": "video", "name": "SkyReels V4", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["480P", "720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/skyreels-v4/generation"], "duration": {"min": 3, "max": 15, "step": 1}, "pattern": /skyreels-v4/i },
    {"kind": "video", "name": "HappyHorse 1.1", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"], "resolutions": ["720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/happyhorse-1.1/generation"], "duration": {"min": 3, "max": 15, "step": 1}, "pattern": /happyhorse-1-1/i },
    {"kind": "video", "name": "PixVerse V6", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["360P", "540P", "720P", "1080P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/pixverse-v6/generation"], "notes": "首尾帧过渡仅 5/8 秒。", "duration": {"min": 1, "max": 15, "step": 1}, "pattern": /pixverse-v6/i },
    {"kind": "video", "name": "Gemini Omni Flash Ext", "ratios": ["16:9", "9:16"], "resolutions": ["360P", "720P", "1080P", "4K"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/omni-flash-ext/generation"], "duration": {"values": [4, 6, 8, 10]}, "pattern": /omni.*flash.*ext/i },
    {"kind": "video", "name": "Gemini Omni Flash Preview", "ratios": ["16:9", "9:16"], "resolutions": ["720P"], "sources": ["https://docs.apimart.ai/en/api-reference/videos/gemini-omni-flash-preview/generation"], "notes": "秒数未查到，面板使用默认 4–15；项目接口不传秒数。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /gemini-omni-flash-preview/i },
    {"kind": "video", "name": "CogVideoX-3", "ratios": ["16:9", "9:16", "1:1"], "resolutions": ["720P", "1080P", "2K", "4K"], "sources": ["https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90%E5%BC%82%E6%AD%A5"], "notes": "官方枚举 1280×720、720×1280、1024×1024、1920×1080、1080×1920、2048×1080、3840×2160；2K 为 2048×1080 的界面档位。", "duration": {"values": [5, 10]}, "ratiosByResolution": {"2K": ["16:9"], "4K": ["16:9"]}, "pattern": /cogvideox-3/i },
    {"kind": "video", "name": "Agnes Video / 2.5", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认；既有接口固定秒数的别名见接入限制。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /agnes-video/i },
    {"kind": "video", "name": "Wan 2.2 / Animate / AutoDL", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认；既有接口固定秒数的别名见接入限制。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /wan-?2-2/i },
    {"kind": "video", "name": "Vidu Q1 / Q2 / 2.0", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认；既有接口固定秒数的别名见接入限制。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /vidu/i },
    {"kind": "video", "name": "Runway / Aleph", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认；既有接口固定秒数的别名见接入限制。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /runway|aleph/i },
    {"kind": "video", "name": "Infinitalk", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认；既有接口固定秒数的别名见接入限制。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /infinitalk/i },
    {"kind": "video", "name": "HappyHorse 1.0", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认；既有接口固定秒数的别名见接入限制。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /happyhorse/i },
    {"kind": "video", "name": "其他 Gemini Omni 视频", "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "resolutions": ["480P", "720P", "1080P"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认；既有接口固定秒数的别名见接入限制。", "duration": {"min": 4, "max": 15, "step": 1}, "pattern": /omni.*flash|gemini-omni-video/i },
    {"kind": "image", "name": "GPT Image 1 / 1.5 / Mini", "ratios": ["1:1", "3:2", "2:3", "adaptive"], "resolutions": ["1K"], "sources": ["https://developers.openai.com/api/reference/cli/resources/images/methods/generate"], "pixelSizes": {"1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536"}, "notes": "low/medium/high 是质量而非分辨率；固定画幅尺寸。", "pattern": /gpt-image-1|4o[- ]image/i },
    {"kind": "image", "name": "GPT Image 2 / 2.5", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:4", "4:5", "2:1", "1:2", "3:1", "1:3", "9:21", "adaptive"], "resolutions": ["1K", "2K", "4K"], "sources": ["https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation"], "notes": "使用中转平台的档位及比例枚举。", "pattern": /gpt-image-2/i },
    {"kind": "image", "name": "Nano Banana / Gemini 2.5 Flash Image", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "4:5", "5:4", "adaptive"], "resolutions": ["1K"], "sources": ["https://ai.google.dev/gemini-api/docs/generate-content/image-generation"], "pattern": /gemini-2-5.*(?:flash|image)|nano-banana(?:-edit)?$/i },
    {"kind": "image", "name": "Nano Banana 2 / Gemini 3.1 Flash Image", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "4:5", "5:4", "1:4", "4:1", "1:8", "8:1", "adaptive"], "resolutions": ["1K", "2K", "4K"], "sources": ["https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation"], "notes": "原生另支持 0.5K；现有 Gemini 直连接口只转换基础八种比例，其他比例隐藏。", "pattern": /gemini-3-1.*(?:flash|image)|nano-banana-?2/i },
    {"kind": "image", "name": "Nano Banana Pro / Gemini 3 Pro Image", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "4:5", "5:4", "adaptive"], "resolutions": ["1K", "2K", "4K"], "sources": ["https://ai.google.dev/gemini-api/docs/generate-content/image-generation"], "pattern": /gemini-3.*(?:pro|image)|nano-banana.*pro/i },
    {"kind": "image", "name": "Seedream 5.0 Pro", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "2:1", "1:2", "adaptive"], "resolutions": ["1K", "2K"], "sources": ["https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation"], "notes": "另支持 1.5K，不支持 4K。", "pattern": /seedream-5.*pro/i },
    {"kind": "image", "name": "Seedream 5.0 Lite", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "2:1", "1:2", "adaptive"], "resolutions": ["2K", "4K"], "sources": ["https://docs.apimart.ai/en/api-reference/images/seedream-5-lite/generation"], "notes": "原生另支持 3K；不支持 1K。", "pattern": /seedream-5.*lite|seedream-5(?:-0)?$/i },
    {"kind": "image", "name": "Seedream 4.5", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "2:1", "1:2", "9:21", "adaptive"], "resolutions": ["2K", "4K"], "sources": ["https://docs.volcengine.com/docs/ark/seedream-4-0-5-0"], "pattern": /seedream-4-5/i },
    {"kind": "image", "name": "Seedream 4.0", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "2:1", "1:2", "9:21", "adaptive"], "resolutions": ["1K", "2K", "4K"], "sources": ["https://docs.volcengine.com/docs/ark/seedream-4-0-5-0"], "pattern": /seedream-v?4/i },
    {"kind": "image", "name": "FLUX.1 / Kontext", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21", "adaptive"], "resolutions": ["1K"], "sources": ["https://help.bfl.ai/articles/8531149640-what-are-the-resolution-limits"], "notes": "Kontext 固定约 1MP；比例可以在 3:7–7:3 内自定义，面板列可用预设。", "pattern": /flux-1|flux-kontext|kontext/i },
    {"kind": "image", "name": "FLUX.2", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21", "adaptive"], "resolutions": ["1K", "2K"], "sources": ["https://help.bfl.ai/articles/8916739058-what-aspect-ratios-and-output-dimensions-are-supported"], "notes": "最高 4MP / 2048×2048，4MP 不是 4K，不列 4K。", "pattern": /flux-?2/i },
    {"kind": "image", "name": "Qwen-Image / Qwen-Image 2", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"], "resolutions": ["1K", "2K"], "sources": ["https://docs.apimart.ai/en/api-reference/images/qwen-image/generation"], "pattern": /qwen.*image|qwen2.*image/i },
    {"kind": "image", "name": "可灵 Image 3 / Omni", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "adaptive"], "resolutions": ["1K", "2K", "4K"], "sources": ["https://kling.ai/document-api/apiReference/model/OmniImage"], "pattern": /kling.*(?:image.*(?:3|v3)|v3.*(?:image|omni))/i },
    {"kind": "image", "name": "可灵 Image O1 / 2.x", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "adaptive"], "resolutions": ["1K", "2K"], "sources": ["https://kling.ai/document-api/apiReference/model/OmniImage"], "notes": "具体版本能力须依官方 capability map；O1 为 1K/2K。", "pattern": /kling/i },
    {"kind": "image", "name": "Grok 图片", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "5:2", "adaptive"], "resolutions": ["1K", "2K"], "sources": ["https://docs.x.ai/developers/model-capabilities/images/generation"], "pattern": /grok.*imagine/i },
    {"kind": "image", "name": "Z-Image Turbo", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"], "resolutions": ["1K", "2K"], "sources": ["https://docs.apimart.ai/en/api-reference/images/z-image-turbo/generation"], "pattern": /z-image/i },
    {"kind": "image", "name": "万相 Wan 2.7 Image Pro", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"], "resolutions": ["1K", "2K", "4K"], "sources": ["https://docs.apimart.ai/en/api-reference/images/wan2.7-image/generation"], "pattern": /wan-?2-7.*image.*pro/i },
    {"kind": "image", "name": "万相 Wan 2.7 Image", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"], "resolutions": ["1K", "2K"], "sources": ["https://docs.apimart.ai/en/api-reference/images/wan2.7-image/generation"], "pattern": /wan-?2-7.*image/i },
    {"kind": "image", "name": "Imagen 4", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4"], "resolutions": ["1K", "2K"], "sources": ["https://ai.google.dev/gemini-api/docs/imagen"], "pattern": /imagen-?4/i },
    {"kind": "image", "name": "GLM-Image", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"], "resolutions": ["1K", "2K"], "sources": ["https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image"], "notes": "宽高 512–2048 且为 32 倍数；按当前界面档位换算并对齐。", "pixelAlignment": 32, "maxImagePixels": 4194304, "pattern": /glm-image/i },
    {"kind": "image", "name": "DALL·E / Dalle", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["1K", "2K", "4K"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认。", "pattern": /dall-e|dalle/i },
    {"kind": "image", "name": "其他 Seedream", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["1K", "2K", "4K"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认。", "pattern": /seedream/i },
    {"kind": "image", "name": "其他 Flux", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["1K", "2K", "4K"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认。", "pattern": /flux/i },
    {"kind": "image", "name": "Ideogram / Recraft", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["1K", "2K", "4K"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认。", "pattern": /ideogram|recraft/i },
    {"kind": "image", "name": "SDXL / Stable Diffusion", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["1K", "2K", "4K"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认。", "pattern": /sdxl|stable-diffusion/i },
    {"kind": "image", "name": "Midjourney", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["1K", "2K", "4K"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认。", "pattern": /midjourney/i },
    {"kind": "image", "name": "Agnes Image", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["1K", "2K", "4K"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认。", "pattern": /agnes-image/i },
    {"kind": "image", "name": "Topaz / Gemini Omni Character", "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], "resolutions": ["1K", "2K", "4K"], "sources": [], "notes": "未查到本项目接口的完整参数，使用任务卡默认。", "pattern": /topaz|gemini-omni-character/i },
];

export const defaultVideoCapability: ModelCapability = { kind: "video", name: "未查到", pattern: /./, ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], resolutions: ["480P", "720P", "1080P"], duration: { min: 4, max: 15, step: 1 }, sources: [] };
export const defaultImageCapability: ModelCapability = { kind: "image", name: "未查到", pattern: /./, ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], resolutions: ["1K", "2K", "4K"], sources: [] };

export const commonAspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "adaptive"];

export function orderedAspectRatios(ratios: string[]) {
    return commonAspectRatios.filter((ratio) => ratios.includes(ratio));
}

export function orderedResolutions(resolutions: string[]) {
    const pixels = (tier: string) => {
        const match = tier.match(/^(\d+(?:\.\d+)?)(P|K)$/i);
        if (!match) return Number.POSITIVE_INFINITY;
        return Number(match[1]) * (match[2].toUpperCase() === "K" ? 1000 : 1);
    };
    return [...resolutions].sort((a, b) => pixels(a) - pixels(b));
}

export function capabilityProvider(config: AiConfig, model: string) {
    const scoped = { ...config, model };
    const channel = config.channelMode === "remote" ? config.publicChannels.find((item) => item.id === channelIdForActiveModel(scoped)) : localChannelForActiveModel(scoped);
    return [channelProtocolForConfig(scoped), channel?.id, channel?.name, channel?.baseUrl, channel && "remark" in channel ? channel.remark : ""].filter(Boolean).join(" ").toLowerCase();
}

export function getModelCapability(model: string, kind: "video" | "image", provider = ""): ModelCapability {
    const key = modelKey(model);
    const matches = modelCapabilitiesTable.filter((row) => row.kind === kind && row.pattern.test(key));
    const row = matches.find((item) => item.provider && provider.includes(item.provider)) || matches.find((item) => !item.provider) || (kind === "video" ? defaultVideoCapability : defaultImageCapability);
    const tier = key.match(/(?:^|[- ])(480p|720p|768p|1080p|2k|4k)(?:$|[- 官方])/i)?.[1].toUpperCase();
    return kind === "video" && tier && row.resolutions.includes(tier) ? { ...row, resolutions: [tier] } : row;
}

export function nearestResolution(value: string, allowed: string[]) {
    const normalized = ({ low: "480P", auto: "720P", medium: "720P", high: "720P" } as Record<string, string>)[value] || value.toUpperCase().replace(/^(\d+(?:\.\d+)?)$/, "$1P");
    if (allowed.includes(normalized)) return normalized;
    const pixels = (tier: string) => tier.toUpperCase().endsWith("K") ? Number(tier.slice(0, -1)) * 1000 : Number(tier.replace(/P$/i, ""));
    const target = pixels(normalized);
    return allowed.reduce((best, tier) => Math.abs(pixels(tier) - target) < Math.abs(pixels(best) - target) ? tier : best, allowed[0] || normalized);
}

export function nearestRatio(value: string, allowed: string[]) {
    if (["auto", "adaptive", ""].includes(value)) return allowed.includes("adaptive") ? "adaptive" : allowed[0];
    if (allowed.includes(value)) return value;
    const parts = value.split(/x|:/).map(Number);
    const target = parts[0] / parts[1];
    const candidates = allowed.filter((ratio) => ratio !== "adaptive");
    const number = (ratio: string) => { const [w, h] = ratio.split(":").map(Number); return w / h; };
    return candidates.reduce((best, ratio) => Math.abs(number(ratio) - target) < Math.abs(number(best) - target) ? ratio : best, candidates[0] || allowed[0]);
}

export function legalDurations(rule: DurationCapability = defaultVideoCapability.duration!) {
    if (rule.values?.length) return [...rule.values].sort((a, b) => a - b);
    const min = rule.min ?? 4;
    const max = rule.max ?? 15;
    const step = rule.step ?? 1;
    return Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, index) => Number((min + index * step).toFixed(3)));
}

export function nearestDuration(value: string | number, rule?: DurationCapability) {
    const values = legalDurations(rule);
    const seconds = Number(value);
    return values.reduce((best, candidate) => Math.abs(candidate - seconds) < Math.abs(best - seconds) ? candidate : best, values[0]);
}
