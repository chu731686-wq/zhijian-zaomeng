"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Input, Slider, Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { useAutoDLWorkflow } from "@/hooks/use-autodl-workflow";
import { getAutoDLCapabilities, isAutoDLConfig } from "@/lib/autodl";
import { capabilityProvider, getModelCapability, legalDurations, nearestDuration, nearestRatio, nearestResolution, orderedAspectRatios, orderedResolutions } from "@/lib/model-capabilities-table";
import { boolConfig, isSeedanceFastOrMiniModel, isSeedanceVideoModel, seedancePixelLabel, seedanceRatioOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { isCogVideoX3Model, modelKey, supportsVideoAudioGeneration } from "@/lib/video-model-capabilities";
import { grokVideoModeOptions, isAPIMartKlingV26Config, isAPIMartKlingV3Config, isKIEGrokVideoModel, isKIEKlingV3Config } from "@/services/api/protocols/kling-models";
import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";

export { isAPIMartKlingV26Config, isAPIMartKlingV3Config, isAPIMartKlingMotionControlConfig, isKIEKlingV3Config, kieKlingOmniVariant, isKIEKlingMotionControlConfig, isKIEGrokVideoModel } from "@/services/api/protocols/kling-models";

export const videoResolutionOptions = [
    { value: "720", label: "720P" },
    { value: "480", label: "480P" },
    { value: "1080", label: "1080P" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
];
type VideoSettingsPanelProps = {
    config: AiConfig;
    modelName?: string;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoMode" | "videoNegativePrompt" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    hideNegativePrompt?: boolean;
    visualOnly?: boolean;
};

export function VideoSettingsPanel({ config, modelName, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", hideNegativePrompt = false, visualOnly = false }: VideoSettingsPanelProps) {
    const model = modelName || config.model || config.videoModel;
    const autodl = isAutoDLConfig(config, model);
    if (isAPIMartKlingV26Config(config, modelName || config.model || config.videoModel) || isAPIMartKlingV3Config(config, modelName || config.model || config.videoModel) || isKIEKlingV3Config(config, modelName || config.model || config.videoModel)) {
        return <KlingV26VideoSettingsPanel config={config} modelName={modelName} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} hideNegativePrompt={hideNegativePrompt} visualOnly={visualOnly} />;
    }
    if (!autodl && isSeedanceVideoModel(model)) {
        return <SeedanceVideoSettingsPanel config={config} modelName={modelName} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} visualOnly={visualOnly} />;
    }

    const grokMode = config.videoMode === "fun" || config.videoMode === "spicy" ? config.videoMode : "normal";
    const audioGenerationEnabled = supportsVideoAudioGeneration(model, channelProtocolForConfig({ ...config, model, videoModel: model }));
    const generateAudio = boolConfig(config.videoGenerateAudio, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                {!visualOnly && isKIEGrokVideoModel(config, model) ? (
                    <SettingGroup title="模式选择" color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2.5">
                            {grokVideoModeOptions.map((item) => (
                                <OptionPill key={item.value} selected={grokMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                                    {item.title}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}
                <VideoOutputSettings config={config} modelName={modelName} onConfigChange={onConfigChange} theme={theme} visualOnly={visualOnly} />
                {!visualOnly ? (
                    <>
                        {audioGenerationEnabled ? <AudioGenerationSetting checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                    </>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function KlingV26VideoSettingsPanel({ config, modelName, onConfigChange, theme, showTitle, className, hideNegativePrompt, visualOnly }: VideoSettingsPanelProps) {
    const isV3 = isAPIMartKlingV3Config(config, modelName || config.model || config.videoModel) || isKIEKlingV3Config(config, modelName || config.model || config.videoModel);
    const generateAudio = boolConfig(config.videoGenerateAudio, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                {hideNegativePrompt || visualOnly ? null : (
                    <SettingGroup title="负面提示词" color={theme.node.muted}>
                        <Input.TextArea
                            value={config.videoNegativePrompt || ""}
                            placeholder="描述不希望出现在视频中的内容"
                            autoSize={{ minRows: 3, maxRows: 6 }}
                            className="rounded-xl placeholder:!text-[var(--canvas-placeholder)] placeholder:!opacity-55"
                            style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text, "--canvas-placeholder": theme.node.placeholder } as CSSProperties}
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(event) => onConfigChange("videoNegativePrompt", event.target.value)}
                        />
                    </SettingGroup>
                )}
                <VideoOutputSettings config={config} modelName={modelName} onConfigChange={onConfigChange} theme={theme} visualOnly={visualOnly} kling />
                {!visualOnly ? (
                    <>
                        <AudioGenerationSetting checked={generateAudio} hint={isV3 ? undefined : "仅 1080P，仅一张参考图可用"} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                    </>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, modelName, onConfigChange, theme, showTitle, className, visualOnly }: VideoSettingsPanelProps) {
    const model = modelName || config.model || config.videoModel;
    const watermark = boolConfig(config.videoWatermark, false);
    const audioGenerationEnabled = supportsVideoAudioGeneration(model, channelProtocolForConfig({ ...config, model, videoModel: model }));
    const generateAudio = boolConfig(config.videoGenerateAudio, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <VideoOutputSettings config={config} modelName={modelName} onConfigChange={onConfigChange} theme={theme} visualOnly={visualOnly} seedance />
                {!visualOnly ? (
                    <>
                        {audioGenerationEnabled ? <AudioGenerationSetting checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                        <SettingGroup title="输出" color={theme.node.muted}>
                            <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                                <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                            </div>
                        </SettingGroup>
                    </>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function VideoOutputSettings({ config, modelName, onConfigChange, theme, visualOnly, seedance = false, kling = false }: VideoSettingsPanelProps & { seedance?: boolean; kling?: boolean }) {
    const model = modelName || config.model || config.videoModel;
    const provider = capabilityProvider(config, model);
    const capability = getModelCapability(model, "video", provider);
    const { data: workflow } = useAutoDLWorkflow(config, model);
    const autodlRule = isAutoDLConfig(config, model) ? getAutoDLCapabilities(workflow)?.duration : undefined;
    const visibleResolutions = orderedResolutions(capability.resolutions);
    const modeResolution = config.videoMode === "4k" ? "4K" : config.videoMode === "pro" ? "1080P" : "720P";
    const resolution = nearestResolution(kling ? modeResolution : config.vquality, visibleResolutions.length ? visibleResolutions : capability.resolutions);
    const ratios = orderedAspectRatios((capability.ratiosByResolution?.[resolution] || capability.ratios).filter((ratio) => !(ratio === "9:21" && provider.includes("kie") && modelKey(model).includes("v1-lite"))));
    const ratio = nearestRatio(config.size, ratios);
    const rule = autodlRule ? { min: autodlRule.min ?? 4, max: autodlRule.max ?? 15, step: 1 } : isCogVideoX3Model(model) ? { values: [5, 10] } : capability.durationByResolution?.[resolution] || capability.duration;
    const values = legalDurations(rule);
    const duration = nearestDuration(config.videoSeconds, rule);
    const seedance20 = (modelKey(model).includes("seedance-2-0") || modelKey(model) === "bytedance-seedance-2") && !isSeedanceFastOrMiniModel(model);
    const resolutionValue = (tier: string) => seedance && !seedance20 ? tier.toLowerCase() : ["480P", "720P", "1080P"].includes(tier) ? tier.toLowerCase().replace(/p$/, "") : tier.toLowerCase();
    const sizeValue = (nextRatio: string, tier = resolution) => seedance || kling ? nextRatio : nextRatio === "adaptive" ? "auto" : videoSizeForResolution(tier, nextRatio);
    const storedResolution = resolutionValue(resolution);
    const storedSize = sizeValue(ratio);
    const storedSeconds = String(duration);

    // Persist corrected values as well as displaying them, including on model changes.
    useEffect(() => {
        if (config.vquality !== storedResolution) onConfigChange("vquality", storedResolution);
        if (config.size !== storedSize) onConfigChange("size", storedSize);
        if (!visualOnly && config.videoSeconds !== storedSeconds) onConfigChange("videoSeconds", storedSeconds);
    }, [config.vquality, config.size, config.videoSeconds, storedResolution, storedSize, storedSeconds, visualOnly, onConfigChange]);

    const updateResolution = (tier: string) => {
        onConfigChange("vquality", resolutionValue(tier));
        if (kling) onConfigChange("videoMode", tier === "4K" ? "4k" : tier === "1080P" ? "pro" : "std");
        const nextRatio = nearestRatio(config.size, (capability.ratiosByResolution?.[tier] || capability.ratios).filter((ratio) => !(ratio === "9:21" && provider.includes("kie") && modelKey(model).includes("v1-lite"))));
        onConfigChange("size", sizeValue(nextRatio, tier));
        if (!visualOnly) onConfigChange("videoSeconds", String(nearestDuration(config.videoSeconds, capability.durationByResolution?.[tier] || rule)));
    };

    return (
        <>
            <SettingGroup title="清晰度" color={theme.node.muted}>
                <div className="grid grid-cols-3 gap-2.5">
                    {visibleResolutions.map((tier) => <OptionPill key={tier} selected={resolution === tier} theme={theme} onClick={() => updateResolution(tier)}>{tier}</OptionPill>)}
                </div>
                {!visibleResolutions.length ? <div className="text-xs" style={{ color: theme.node.muted }}>该模型使用固定输出规格</div> : null}
            </SettingGroup>
            <SettingGroup title="比例" color={theme.node.muted}>
                <div className="grid grid-cols-3 gap-2.5">
                    {ratios.map((item) => (
                        <button key={item} type="button" aria-pressed={ratio === item} className="flex h-[60px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80" style={{ borderColor: ratio === item ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={() => onConfigChange("size", sizeValue(item))}>
                            <SizePreview {...ratioPreview(item)} color={theme.node.text} />
                            <span>{item === "adaptive" ? "自适应" : item}</span>
                        </button>
                    ))}
                </div>
            </SettingGroup>
            {!visualOnly ? (
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                        <Slider className="!mx-2 flex-1" ariaLabelForHandle="秒数" min={values[0]} max={values[values.length - 1]} step={rule?.values ? null : rule?.step ?? 1} marks={rule?.values ? Object.fromEntries(values.map((value) => [value, `${value}`])) : undefined} disabled={values.length === 1} value={duration} tooltip={{ formatter: (value) => `${value} 秒` }} onChange={(value) => onConfigChange("videoSeconds", String(nearestDuration(value, rule)))} />
                        <span className="min-w-10 text-right text-sm tabular-nums">{duration} 秒</span>
                    </div>
                </SettingGroup>
            ) : null}
        </>
    );
}

export function videoResolutionLabel(value: string) {
    const resolution = normalizeVideoResolutionValue(value);
    return /[pk]$/i.test(resolution) ? resolution.toUpperCase() : `${resolution}P`;
}

export function videoSizeLabel(value: string) {
    const ratio = nearestRatio(value, [...getModelCapability("", "video").ratios, "3:2", "2:3", "9:21", "adaptive"]);
    return ratio === "adaptive" ? "自适应" : ratio || value;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return "智能";
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    const native = (value || "720").trim().match(/^(\d+(?:\.\d+)?)(p|k)$/i);
    if (native && !(native[2].toUpperCase() === "P" && ["480", "720", "1080"].includes(native[1]))) return `${native[1]}${native[2].toUpperCase()}`;
    return (value || "720").toLowerCase().replace(/p$/i, "");
}

export function videoSizeForResolution(resolution: string, size: string) {
    const ratio = nearestRatio(size, ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "3:2", "2:3", "9:21", "adaptive"]);
    if (ratio === "adaptive") return "auto";
    const normalizedResolution = normalizeVideoResolutionValue(resolution);
    if (seedanceRatioOptions.some((item) => item.value === ratio)) return seedancePixelLabel(normalizedResolution, ratio);
    const [w, h] = ratio.split(":").map(Number);
    const edge = ({ "480": 480, "720": 720, "1080": 1080, "2k": 1440, "4k": 2160 } as Record<string, number>)[normalizedResolution] || (normalizedResolution.toLowerCase().endsWith("k") ? Number(normalizedResolution.slice(0, -1)) * 1000 : Number(normalizedResolution.replace(/P$/i, ""))) || 720;
    const scale = edge / Math.min(w, h);
    return `${Math.round(w * scale / 8) * 8}x${Math.round(h * scale / 8) * 8}`;
}

export function videoSizeOptions(resolution: string) {
    const normalizedResolution = normalizeVideoResolutionValue(resolution);
    return seedanceRatioOptions.map((item) => {
        const value = item.value === "adaptive" ? "auto" : seedancePixelLabel(normalizedResolution, item.value);
        return { value, label: value };
    });
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    const [width, height] = ratio.split(":").map(Number);
    return { width: width || 0, height: height || 0 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function AudioGenerationSetting({ checked, hint, theme, onChange }: { checked: boolean; hint?: string; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <SettingGroup title="音频生成" color={theme.node.muted}>
            <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                <SwitchRow label="是否生成与视频同步的AI音频" checked={checked} theme={theme} onChange={onChange} />
                {hint ? <div className="text-[11px] leading-4 opacity-55">{hint}</div> : null}
            </div>
        </SettingGroup>
    );
}
