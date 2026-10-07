"use client";

import { useEffect, type ReactNode } from "react";
import { ConfigProvider } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";
import { capabilityProvider, getModelCapability, nearestRatio, nearestResolution, orderedAspectRatios, orderedResolutions } from "@/lib/model-capabilities-table";

const qualityOptions = [
    { value: "low", label: "1K" },
    { value: "medium", label: "2K" },
    { value: "high", label: "4K" },
];

const aspectOptions = [
    { value: "1:1", label: "1:1", width: 1, height: 1, icon: "square" },
    { value: "3:2", label: "3:2", width: 3, height: 2, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 2, height: 3, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 4, height: 3, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 3, height: 4, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 16, height: 9, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 9, height: 16, icon: "portrait" },
    { value: "21:9", label: "21:9", width: 21, height: 9, icon: "landscape" },
    { value: "auto", label: "自适应", width: 0, height: 0, icon: "auto" },
];

export const imageSizeOptions = aspectOptions.map((item) => ({
    value: item.value,
    label: item.label,
}));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    showSize?: boolean;
    showCount?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, showSize = true, showCount = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: ImageSettingsPanelProps) {
    const model = config.model || config.imageModel;
    const capability = getModelCapability(model, "image", capabilityProvider(config, model));
    const resolutions = orderedResolutions(capability.resolutions);
    const quality = nearestResolution(imageQualityLabel(config.quality || "low"), resolutions);
    const count = Math.max(1, Math.min(4, Math.floor(Math.abs(Number(config.count)) || 1)));
    // The existing native Gemini adapter only passes these aspect ratios through.
    const nativeGemini = channelProtocolForConfig({ ...config, model }) === "gemini";
    const ratios = orderedAspectRatios(capability.ratios.filter((ratio) => !nativeGemini || aspectOptions.some((item) => item.value === ratio) || ratio === "adaptive"));
    const selectedAspect = nearestRatio(config.size || "auto", ratios);
    const qualityValue = qualityOptions.find((item) => item.label === quality)?.value || quality.toLowerCase();
    const sizeValue = (ratio: string) => {
        if (ratio === "adaptive") return "auto";
        if (capability.pixelSizes?.[ratio]) return capability.pixelSizes[ratio];
        if (!capability.pixelAlignment) return ratio;
        const [w, h] = ratio.split(":").map(Number);
        const edge = quality === "2K" ? 2048 : 1024;
        const scale = Math.min(edge / Math.max(w, h), Math.sqrt((capability.maxImagePixels || edge * edge) / (w * h)));
        const align = (value: number) => Math.max(512, Math.floor(value / capability.pixelAlignment!) * capability.pixelAlignment!);
        return `${align(w * scale)}x${align(h * scale)}`;
    };
    const storedSize = sizeValue(selectedAspect);
    useEffect(() => {
        if (!showSize) return;
        if (config.quality !== qualityValue) onConfigChange("quality", qualityValue);
        if (config.size !== storedSize) onConfigChange("size", storedSize);
    }, [showSize, config.quality, config.size, qualityValue, storedSize, onConfigChange]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                {showSize ? (
                    <>
                        <div className="space-y-2.5">
                            <SettingTitle color={theme.node.muted}>清晰度</SettingTitle>
                            <div className="grid grid-cols-3 gap-2.5">
                                {resolutions.map((tier) => (
                                    <OptionPill key={tier} selected={quality === tier} theme={theme} onClick={() => onConfigChange("quality", qualityOptions.find((item) => item.label === tier)?.value || tier.toLowerCase())}>{tier}</OptionPill>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            <SettingTitle color={theme.node.muted}>比例</SettingTitle>
                            <div className="grid grid-cols-4 gap-2.5">
                                {ratios.map((ratio) => {
                                    const [width, height] = ratio.split(":").map(Number);
                                    return (
                                        <button
                                            key={ratio}
                                            type="button"
                                            aria-pressed={selectedAspect === ratio}
                                            className="flex h-[64px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                            style={{ borderColor: selectedAspect === ratio ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onClick={() => onConfigChange("size", sizeValue(ratio))}
                                        >
                                            <AspectIcon type={ratio === "adaptive" ? "auto" : "ratio"} width={width} height={height} color={theme.node.text} />
                                            <span>{ratio === "adaptive" ? "自适应" : ratio}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                ) : null}
                {showCount ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                        <div className="grid grid-cols-4 gap-2.5">
                            {[1, 2, 3, 4].map((value) => (
                                <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                    {value} 张
                                </OptionPill>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ({ auto: "1K", high: "4K", medium: "2K", low: "1K" } as Record<string, string>)[value] || value;
}

export function imageSizeLabel(size: string) {
    if (size === "adaptive" || size === "auto") return "自适应";
    return aspectOptions.find((item) => item.value === size)?.label || legacyAspectOption(size)?.label || size;
}

function OptionPill({ selected, disabled = false, title, theme, onClick, children }: { selected: boolean; disabled?: boolean; title?: string; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={title}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function legacyAspectOption(size: string) {
    const dimensions = size.match(/^(\d+)x(\d+)$/);
    if (!dimensions) return undefined;
    const ratio = Number(dimensions[1]) / Number(dimensions[2]);
    return aspectOptions.reduce((best, current) => Math.abs(current.width / current.height - ratio) < Math.abs(best.width / best.height - ratio) ? current : best);
}

export function imageFormatLabel(format: string) {
    const map: Record<string, string> = { png: "PNG", jpeg: "JPEG", webp: "WebP" };
    return map[format] || format;
}
