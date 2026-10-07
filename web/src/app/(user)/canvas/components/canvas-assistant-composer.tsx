"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUp, Brain, Check, Cpu, Globe, FolderOpen, ImageIcon, Menu, Square, Upload, Video, X } from "lucide-react";
import { Button, Dropdown, Popover, Select, Tooltip } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { filterModelsByCapability, normalizeLocalChannels, resolveModelForCapability, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { isWorkflowProtocol } from "@/lib/model-channel";
import { useWebSearchPreference } from "@/stores/use-web-search-store";
import { fetchWebSearchSettings } from "@/services/api/web-search";
import { useUserStore } from "@/stores/use-user-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasAgentConfig, type CanvasAgentSkillSelection, type CanvasAssistantReference } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { CanvasAgentSkillPopover } from "./canvas-agent-skill-popover";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";

export type CanvasAssistantComposerProps = {
    prompt: string;
    isRunning: boolean;
    codexControls?: ReactNode;
    references: CanvasAssistantReference[];
    linkedReferences?: CanvasResourceReference[];
    onReferenceRemove?: (nodeId: string) => void;
    availableReferences?: CanvasResourceReference[];
    pendingReferences?: CanvasResourceReference[];
    selectedSkills?: CanvasAgentSkillSelection[];
    agentConfig: CanvasAgentConfig;
    onAgentConfigChange: (patch: Partial<CanvasAgentConfig>) => void;
    onPromptChange: (prompt: string) => void;
    onReferenceIdsChange: (ids: string[]) => void;
    onSkillSelect?: (skill: CanvasAgentSkillSelection) => void;
    onSkillRemove?: (id: string, source: CanvasAgentSkillSelection["source"]) => void;
    onSubmit: (prompt?: string, referenceIds?: string[]) => void | Promise<void>;
    onStop?: () => void;
    onOpenUpload: () => void;
    onOpenAssets: () => void;
    onPasteImage: (file: File) => void;
};

export function CanvasAssistantComposer({
    prompt,
    isRunning,
    codexControls,
    references,
    linkedReferences = [],
    onReferenceRemove,
    availableReferences,
    pendingReferences,
    selectedSkills,
    agentConfig,
    onAgentConfigChange,
    onPromptChange,
    onReferenceIdsChange,
    onSkillSelect,
    onSkillRemove,
    onSubmit,
    onStop,
    onOpenUpload,
    onOpenAssets,
    onPasteImage,
}: CanvasAssistantComposerProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [modelPanelOpen, setModelPanelOpen] = useState(false);
    const selectableTextModels = useMemo(() => selectableModelsByCapability(effectiveConfig, "text"), [effectiveConfig]);
    const selectableImageModels = useMemo(() => selectableModelsByCapability(effectiveConfig, "image"), [effectiveConfig]);
    const selectableVideoModels = useMemo(() => selectableModelsByCapability(effectiveConfig, "video"), [effectiveConfig]);
    const resolvedTextModel = resolveModelForCapability(effectiveConfig, agentConfig.textModel, "text");
    const resolvedImageModel = resolveModelForCapability(effectiveConfig, agentConfig.imageModel, "image");
    const resolvedVideoModel = resolveModelForCapability(effectiveConfig, agentConfig.videoModel, "video");
    const channels = useMemo(() => (effectiveConfig.channelMode === "remote"
        ? effectiveConfig.publicChannels
        : normalizeLocalChannels(effectiveConfig)).filter((channel) => channel.id && !isWorkflowProtocol(channel.protocol || "")), [effectiveConfig]);
    const modelOptions = (capability: "text" | "image" | "video", selectable: string[], selectedModel: string, selectedChannelId?: string) => {
        const allowed = new Set(selectable);
        const channelOptions = channels.flatMap((channel) => {
            const models = filterModelsByCapability(channel.models || [], capability, channel.protocol || "").filter((model) => allowed.has(model));
            return models.length ? [{ channel, models }] : [];
        });
        const selectedChannel = channelOptions.find(({ channel }) => channel.id === selectedChannelId)?.channel || channelOptions.find(({ models }) => models.includes(selectedModel))?.channel;
        const selectedModels = channelOptions.find(({ channel }) => channel.id === selectedChannel?.id)?.models || [];
        return {
            channels: channelOptions,
            channelId: selectedChannel?.id,
            models: selectedModels,
            model: selectedModels.includes(selectedModel) ? selectedModel : selectedModels[0],
            channelName: selectedChannel?.name || "",
        };
    };
    const textSelection = modelOptions("text", selectableTextModels, resolvedTextModel, agentConfig.textChannelId || effectiveConfig.textChannelId);
    const imageSelection = modelOptions("image", selectableImageModels, resolvedImageModel, agentConfig.imageChannelId || effectiveConfig.imageChannelId);
    const videoSelection = modelOptions("video", selectableVideoModels, resolvedVideoModel, agentConfig.videoChannelId || effectiveConfig.videoChannelId);
    const { provider: webSearchProvider, enabled: webSearchEnabled, setProvider: setWebSearchProvider } = useWebSearchPreference();
    const token = useUserStore((state) => state.token);
    const [bochaConfigured, setBochaConfigured] = useState(false);
    const [webSearchSettingsLoaded, setWebSearchSettingsLoaded] = useState(false);
    useEffect(() => {
        let canceled = false;
        setWebSearchSettingsLoaded(false);
        setBochaConfigured(false);
        if (token) void fetchWebSearchSettings(token).then((settings) => {
            if (!canceled) { setBochaConfigured(settings.configured); setWebSearchSettingsLoaded(true); }
        }).catch(() => { if (!canceled) { setBochaConfigured(false); setWebSearchSettingsLoaded(true); } });
        else setWebSearchSettingsLoaded(true);
        return () => { canceled = true; };
    }, [token]);
    useEffect(() => {
        if (webSearchSettingsLoaded && !bochaConfigured && webSearchProvider === "bocha") setWebSearchProvider("toutiao");
    }, [bochaConfigured, setWebSearchProvider, webSearchProvider, webSearchSettingsLoaded]);
    const reasoningEnabled = agentConfig.textReasoningEnabled === true;
    const imageConfig = useMemo(() => ({ ...effectiveConfig, quality: agentConfig.imageQuality, size: agentConfig.imageSize }), [agentConfig.imageQuality, agentConfig.imageSize, effectiveConfig]);
    const videoConfig = useMemo(() => ({ ...effectiveConfig, vquality: agentConfig.videoQuality, size: agentConfig.videoSize }), [agentConfig.videoQuality, agentConfig.videoSize, effectiveConfig]);
    const promptReferences = useMemo(() => {
        const seen = new Set<string>();
        return [...(availableReferences || []), ...references.map(assistantToPromptReference)].filter((reference) => {
            if (seen.has(reference.nodeId)) return false;
            seen.add(reference.nodeId);
            return true;
        });
    }, [availableReferences, references]);
    const submit = (nextPrompt = prompt, referenceIds = references.map((reference) => reference.id)) => onSubmit(nextPrompt, referenceIds);

    return (
        <div className="px-2 pb-2" onWheel={(event) => event.stopPropagation()}>
            {linkedReferences.length ? <div className="mb-2 flex flex-wrap gap-1.5 px-1" aria-label="关联节点">
                {linkedReferences.slice(0, 4).map((reference) => <span key={reference.nodeId} className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border px-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.text, background: theme.toolbar.panel }}>
                    <span className="max-w-36 truncate">{reference.title || reference.label}</span>
                    <button type="button" className="grid size-5 shrink-0 place-items-center rounded-full opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" onClick={() => onReferenceRemove?.(reference.nodeId)} aria-label={`移除关联节点${reference.title}`}><X className="size-3" /></button>
                </span>)}
            </div> : null}
            <div className="rounded-2xl border px-3 pb-3 pt-3" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                <CanvasPromptChipInput
                    value={prompt}
                    references={promptReferences}
                    pendingReferences={[]}
                    skills={selectedSkills}
                    onSkillRemove={onSkillRemove}
                    onChange={onPromptChange}
                    onReferenceIdsChange={onReferenceIdsChange}
                    onPasteImage={onPasteImage}
                    onSubmit={submit}
                    className="thin-scrollbar min-h-20 max-h-[220px] w-full px-1 py-0 text-sm leading-5"
                    style={{ color: theme.node.text }}
                    placeholder="描述创作目标，或让我继续操作画布"
                    placeholderClassName="!left-1 !top-0"
                    compositionAwarePlaceholder
                />
                <div className="@container mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    { key: "upload", icon: <Upload className="size-4" />, label: "上传文件" },
                                    { key: "assets", icon: <FolderOpen className="size-4" />, label: "我的素材" },
                                ],
                                onClick: ({ key }) => (key === "upload" ? onOpenUpload() : onOpenAssets()),
                            }}
                        >
                        <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8 !shrink-0" style={{ color: theme.node.text }} icon={<Menu className="size-4" />} aria-label="添加素材" />
                        </Dropdown>
                        {onSkillSelect && onSkillRemove ? <CanvasAgentSkillPopover selectedSkills={selectedSkills} onSelect={onSkillSelect} onDeleteSelected={onSkillRemove} /> : null}
                        {codexControls}
                        <Tooltip title={`文字：${textSelection.channelName ? `${textSelection.channelName} · ` : ""}${resolvedTextModel}`}>
                            <Popover
                                trigger="click"
                                placement="topLeft"
                                autoAdjustOverflow
                                open={modelPanelOpen}
                                onOpenChange={setModelPanelOpen}
                                content={<div className="w-72 space-y-3 py-1" onWheel={(event) => event.stopPropagation()}>
                                    {([
                                        ["文字模型", "text", selectableTextModels, resolvedTextModel, textSelection],
                                        ["图片模型", "image", selectableImageModels, resolvedImageModel, imageSelection],
                                        ["视频模型", "video", selectableVideoModels, resolvedVideoModel, videoSelection],
                                    ] as const).map(([label, capability, models, selected, selection]) => <label key={capability} className="block">
                                        <span className="mb-1 block break-all text-xs" style={{ color: theme.node.muted }}>{label}{selection.model ? <span className="opacity-80"> · {selection.model}</span> : null}</span>
                                        <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] gap-1.5">
                                            <Select
                                                className="min-w-0"
                                                size="small"
                                                showSearch
                                                virtual={false}
                                                optionFilterProp="label"
                                                value={selection.channelId}
                                                options={selection.channels.map(({ channel }) => ({ value: channel.id, label: channel.name || "未命名接口" }))}
                                                placeholder="接口"
                                                popupMatchSelectWidth={false}
                                                classNames={{ popup: { root: "assistant-model-popup" } }}
                                                styles={{ popup: { root: { minWidth: 260, maxWidth: 360 } } }}
                                                disabled={!models.length}
                                                popupRender={(menu) => <div onWheel={(event) => event.stopPropagation()}>{menu}</div>}
                                                onChange={(channelId: string) => {
                                                    const nextModels = selection.channels.find(({ channel }) => channel.id === channelId)?.models || [];
                                                    onAgentConfigChange({ [`${capability}Model`]: nextModels[0] || "", [`${capability}ChannelId`]: channelId });
                                                }}
                                            />
                                            <Select
                                                className="min-w-0"
                                                size="small"
                                                showSearch
                                                virtual={false}
                                                optionFilterProp="label"
                                                value={selection.model}
                                                options={selection.models.map((model) => ({ value: model, label: model }))}
                                                placeholder={`没有可用的${label.replace("模型", "")}`}
                                                title={selection.model}
                                                popupMatchSelectWidth={false}
                                                classNames={{ popup: { root: "assistant-model-popup" } }}
                                                styles={{ popup: { root: { minWidth: 260, maxWidth: 360 } } }}
                                                disabled={!selection.models.length}
                                                popupRender={(menu) => <div onWheel={(event) => event.stopPropagation()}>{menu}</div>}
                                                onChange={(model: string) => onAgentConfigChange({ [`${capability}Model`]: model, [`${capability}ChannelId`]: selection.channelId })}
                                            />
                                        </div>
                                    </label>)}
                                    <button type="button" className="w-full border-t pt-2 text-left text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }} onClick={() => { setModelPanelOpen(false); openConfigDialog(false, "assistant"); }}>添加或管理接口</button>
                                </div>}
                            >
                                <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8 !shrink-0" style={{ color: theme.node.text }} icon={<Cpu className="size-4" />} aria-label="助手模型" />
                            </Popover>
                        </Tooltip>
                        <CanvasImageSettingsPopover
                            config={imageConfig}
                            placement="topLeft"
                            showCount={false}
                            buttonIcon={<ImageIcon className="size-3.5" />}
                            buttonClassName="!h-8 !w-full !min-w-0 !max-w-[116px] !flex-1 !overflow-hidden !justify-start !rounded-full !px-2.5"
                            onConfigChange={(key, value) => {
                                if (key === "quality") onAgentConfigChange({ imageQuality: value });
                                else if (key === "size") onAgentConfigChange({ imageSize: value });
                            }}
                        />
                        <CanvasVideoSettingsPopover
                            config={videoConfig}
                            placement="topLeft"
                            visualOnly
                            buttonIcon={<Video className="size-3.5" />}
                            buttonClassName="!h-8 !w-full !min-w-0 !max-w-[124px] !flex-1 !overflow-hidden !justify-start !rounded-full !px-2.5"
                            onConfigChange={(key, value) => {
                                if (key === "vquality") onAgentConfigChange({ videoQuality: value });
                                else if (key === "size") onAgentConfigChange({ videoSize: value });
                            }}
                        />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <Tooltip title={webSearchEnabled ? `联网：${webSearchProvider === "bing" ? "必应搜索" : webSearchProvider === "bocha" ? "博查搜索" : "头条搜索"}` : "不联网"}>
                        <Dropdown trigger={["click"]} placement="topRight" disabled={isRunning} menu={{
                            items: [
                                { key: "toutiao", label: <div className="min-w-48 py-1"><div className="flex items-center gap-2 text-sm">头条搜索<span className="rounded px-1.5 py-0.5 text-[10px]" style={{ color: theme.node.text, background: theme.toolbar.activeBg }}>推荐</span>{webSearchProvider === "toutiao" ? <Check className="ml-auto size-4" /> : null}</div><div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>时效强·抖音红果番茄全</div></div> },
                                { key: "bing", label: <div className="min-w-48 py-1"><div className="flex items-center gap-2 text-sm">必应搜索{webSearchProvider === "bing" ? <Check className="ml-auto size-4" /> : null}</div><div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>全网网页覆盖广</div></div> },
                                ...(bochaConfigured ? [{ key: "bocha", label: <div className="min-w-48 py-1"><div className="flex items-center gap-2 text-sm">博查搜索{webSearchProvider === "bocha" ? <Check className="ml-auto size-4" /> : null}</div><div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>付费·结果稳定</div></div> }] : []),
                                { key: "off", label: <div className="min-w-48 py-1"><div className="flex items-center gap-2 text-sm">不联网{webSearchProvider === "off" ? <Check className="ml-auto size-4" /> : null}</div><div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>只用模型自己的知识</div></div> },
                            ],
                            onClick: ({ key }) => setWebSearchProvider(key as "off" | "toutiao" | "bing" | "bocha"),
                        }}>
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8"
                                style={{ color: theme.node.text, background: webSearchEnabled ? theme.toolbar.activeBg : undefined }}
                                icon={<Globe className="size-4" />} aria-label="联网" aria-pressed={webSearchEnabled}
                                disabled={isRunning} />
                        </Dropdown>
                        </Tooltip>
                        {!codexControls ? (
                        <Button
                            type="text"
                            shape="circle"
                            className="!h-8 !w-8 !min-w-8"
                            style={{ color: theme.node.text, background: reasoningEnabled ? theme.toolbar.activeBg : undefined }}
                            icon={<Brain className="size-4" />}
                            title={reasoningEnabled ? "推理已开启" : "推理已关闭"}
                            aria-label={reasoningEnabled ? "关闭推理" : "开启推理"}
                            aria-pressed={reasoningEnabled}
                            onClick={() => onAgentConfigChange({ textReasoningEnabled: !reasoningEnabled })}
                        />
                        ) : null}
                        <Button
                            type="primary"
                            shape="circle"
                            className="!size-10 !min-w-10"
                            disabled={!isRunning && !prompt.trim()}
                            onClick={() => (isRunning ? onStop?.() : void submit())}
                            aria-label={isRunning ? "停止" : "发送"}
                            icon={isRunning ? <Square className="size-4 fill-current" /> : <ArrowUp className="size-4" />}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

export function assistantToPromptReference(reference: CanvasAssistantReference): CanvasResourceReference {
    const kind = reference.type === CanvasNodeType.Video ? "video" : reference.type === CanvasNodeType.Audio ? "audio" : reference.type === CanvasNodeType.Text ? "text" : "image";
    return { id: reference.id, nodeId: reference.id, kind, label: reference.label || reference.title, title: reference.title, previewUrl: reference.dataUrl || reference.url, text: reference.text, active: true };
}
