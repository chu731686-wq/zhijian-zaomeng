"use client";

import { Suspense, useMemo, useRef, useState, type ChangeEvent } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, FolderOpen, TriangleAlert } from "lucide-react";
import { HomeShowcase } from "@/components/home/home-showcase";
import { HomeComposer } from "@/components/home/home-composer";
import { HomeTemplates } from "@/components/home/home-templates";
import { HomeProjects, HomeQueue } from "@/components/home/home-projects";
import { uploadAssetMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { filterModelsByCapability, normalizeLocalChannels, useEffectiveConfig, useConfigStore } from "@/stores/use-config-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { AssetPickerModal } from "./canvas/components/asset-picker-modal";
import { useCanvasStore } from "./canvas/stores/use-canvas-store";
import { canvasResourceLabel } from "./canvas/utils/canvas-resource-references";
import { MAX_CANVAS_AGENT_SKILLS, CanvasNodeType, type CanvasAgentConfig, type CanvasAgentSkillSelection, type CanvasAssistantReference, type InsertAssetPayload, type PendingAgentAsset } from "./canvas/types";

function toPendingAgentAsset(payload: InsertAssetPayload, label: string): PendingAgentAsset {
    const nodeId = nanoid();
    let reference: CanvasAssistantReference;
    if (payload.kind === "text") reference = { id: nodeId, type: CanvasNodeType.Text, title: payload.title, label, text: payload.content };
    else {
        const common = { id: nodeId, title: payload.title, label, storageKey: payload.storageKey, mimeType: payload.mimeType };
        if (payload.kind === "image") reference = { ...common, type: CanvasNodeType.Image, dataUrl: payload.dataUrl };
        else if (payload.kind === "video") reference = { ...common, type: CanvasNodeType.Video, url: payload.url };
        else reference = { ...common, type: CanvasNodeType.Audio, url: payload.url };
    }
    return { nodeId, payload, reference };
}

function assetPayload(asset: Asset): InsertAssetPayload {
    const common = { title: asset.title, assetId: asset.id, source: "asset" as const };
    if (asset.kind === "text") return { kind: "text", ...common, ...asset.data };
    if (asset.kind === "image") return { kind: "image", ...common, ...asset.data };
    if (asset.kind === "video") return { kind: "video", ...common, ...asset.data };
    return { kind: "audio", ...common, ...asset.data };
}

function HomePageContent() {
    const { message } = App.useApp();
    const router = useRouter();
    const query = (useSearchParams().get("q") || "").trim();
    const effectiveConfig = useEffectiveConfig();
    const openConfig = useConfigStore((s) => s.openConfigDialog);
    const createProject = useCanvasStore((s) => s.createProject);
    const hydrated = useCanvasStore((s) => s.hydrated);
    const projects = useCanvasStore((s) => s.projects);
    const assets = useAssetStore((s) => s.assets);
    const visibleProjects = useMemo(() => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).filter((p) => p.title.toLowerCase().includes(query.toLowerCase())), [projects, query]);
    const [prompt, setPrompt] = useState("");
    const [pendingAssets, setPendingAssets] = useState<PendingAgentAsset[]>([]);
    const [selectedSkills, setSelectedSkills] = useState<CanvasAgentSkillSelection[]>([]);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [ratio, setRatio] = useState<"9:16" | "16:9">("9:16");
    const [style, setStyle] = useState("默认风格");
    const [agentConfig, setAgentConfig] = useState<CanvasAgentConfig>(() => ({
        textApiMode: "chat",
        autoGenerateMedia: false,
        imageQuality: effectiveConfig.quality,
        imageSize: effectiveConfig.size,
        videoQuality: effectiveConfig.vquality,
        videoSize: effectiveConfig.videoSize,
    }));
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const creationRef = useRef<HTMLDivElement>(null);
    const pendingAssetCountsRef = useRef<Record<InsertAssetPayload["kind"], number>>({ text: 0, image: 0, video: 0, audio: 0 });
    const channels =
        effectiveConfig.channelMode === "remote"
            ? effectiveConfig.publicChannels.filter((c) => c.enabled !== false)
            : normalizeLocalChannels(effectiveConfig)
                  .filter((c) => c.baseUrl.trim() && c.apiKey.trim())
                  .map((c) => ({ ...c, workflows: c.workflowSummaries }));
    const hasVideo =
        channels.some((c) => filterModelsByCapability(c.models || [], "video", c.protocol || "openai").length || c.workflows?.some((w) => w.enabled && w.capability === "video")) ||
        (effectiveConfig.channelMode === "local" && normalizeLocalChannels(effectiveConfig).some((c) => c.workflowSummaries?.some((w) => w.enabled && w.capability === "video")));

    const addPendingAsset = (payload: InsertAssetPayload) => {
        const asset = toPendingAgentAsset(payload, canvasResourceLabel(payload.kind, pendingAssetCountsRef.current[payload.kind]++));
        setPendingAssets((current) => [...current, asset]);
        setPrompt((current) => `${current}${current.endsWith(" ") ? "" : " "}${asset.reference.label} `);
    };
    const uploadFile = async (file: File) => {
        try {
            if (/\.(txt|md|markdown)$/i.test(file.name)) {
                if (file.size > 2 * 1024 * 1024) throw new Error("剧本文件请控制在 2 MB 以内");
                const content = (await file.text()).trim();
                if (!content) throw new Error("剧本文件为空");
                addPendingAsset({ kind: "text", content, title: file.name });
            } else if (file.type.startsWith("image/")) {
                const uploaded = await uploadImage(file);
                addPendingAsset({ kind: "image", dataUrl: uploaded.url, title: file.name, ...uploaded });
            } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
                const uploaded = await uploadAssetMediaFile(file);
                if (file.type.startsWith("video/")) addPendingAsset({ kind: "video", title: file.name, ...uploaded });
                else addPendingAsset({ kind: "audio", title: file.name, ...uploaded });
            } else throw new Error("请上传 TXT、Markdown 剧本，或图片、视频和音频素材");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材上传失败");
        }
    };
    const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void uploadFile(file);
    };
    const onBlank = () => {
        if (!hydrated) return void message.info("画布数据正在加载，请稍后再试");
        router.push(`/canvas/${createProject("未命名项目")}`);
    };
    const submit = (nextPrompt = prompt, referenceIds = pendingAssets.map((a) => a.nodeId)) => {
        const text = nextPrompt.trim();
        if (!text || submitting) return;
        if (!hydrated) return void message.info("画布数据正在加载，请稍后再试");
        setSubmitting(true);
        const titles = new Set(useCanvasStore.getState().projects.map((p) => p.title));
        let title = "新漫剧";
        for (let i = 1; titles.has(title); i++) title = `新漫剧 ${i}`;
        const projectId = createProject(title, {
            agentConfig: { ...agentConfig, videoSize: ratio },
            pendingAgentRequest: { prompt: `${text}\n创作要求：画幅 ${ratio}${style !== "默认风格" ? `，${style}` : ""}。`, assets: pendingAssets.filter((a) => referenceIds.includes(a.nodeId)), skills: selectedSkills },
        });
        router.push(`/canvas/${projectId}`);
    };
    const selectSkill = (skill: CanvasAgentSkillSelection) => {
        const existingIndex = selectedSkills.findIndex((s) => s.id === skill.id && s.source === skill.source);
        if (existingIndex >= 0) return setSelectedSkills(selectedSkills.map((s, i) => (i === existingIndex ? skill : s)));
        if (selectedSkills.length >= MAX_CANVAS_AGENT_SKILLS) return void message.warning(`最多选择 ${MAX_CANVAS_AGENT_SKILLS} 个技能`);
        setSelectedSkills([...selectedSkills, skill]);
    };
    const useTemplate = (nextPrompt: string) => {
        setPrompt(nextPrompt);
        creationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        requestAnimationFrame(() => creationRef.current?.querySelector<HTMLElement>("[contenteditable=true]")?.focus());
    };

    return (
        <main className="home-page thin-scrollbar">
            <div className="home-content">
                {query && (
                    <div className="home-search-summary">
                        <span>搜索“{query}”</span>
                        <button type="button" className="studio-text-link" onClick={() => router.push("/")}>
                            清除搜索
                        </button>
                    </div>
                )}
                <div ref={creationRef}>
                    <HomeComposer
                        prompt={prompt}
                        isRunning={false}
                        references={pendingAssets.map((a) => a.reference)}
                        selectedSkills={selectedSkills}
                        agentConfig={agentConfig}
                        onAgentConfigChange={(patch) => setAgentConfig((current) => ({ ...current, ...patch }))}
                        onPromptChange={setPrompt}
                        onReferenceIdsChange={(ids) => setPendingAssets((current) => current.filter((a) => ids.includes(a.nodeId)))}
                        onSkillSelect={selectSkill}
                        onSkillRemove={(id, source) => setSelectedSkills((current) => current.filter((s) => s.id !== id || s.source !== source))}
                        onSubmit={submit}
                        onOpenUpload={() => uploadInputRef.current?.click()}
                        onOpenAssets={() => setAssetPickerOpen(true)}
                        onPasteImage={(file) => void uploadFile(file)}
                        onBlank={onBlank}
                        submitting={submitting}
                        ratio={ratio}
                        onRatioChange={setRatio}
                        style={style}
                        onStyleChange={setStyle}
                    />
                </div>
                <input ref={uploadInputRef} hidden type="file" accept=".txt,.md,.markdown,image/*,video/*,audio/*" onChange={onUploadInputChange} />
                {!hasVideo && (
                    <div className="home-model-notice">
                        <span className="home-warning-dot" />
                        <TriangleAlert />
                        <p>视频模型还没接入，接入后才能在画布里生成视频</p>
                        <button type="button" className="studio-text-link" onClick={() => openConfig(false)}>
                            去设置
                            <ArrowRight />
                        </button>
                    </div>
                )}
                <div className="home-columns">
                    <HomeTemplates query={query} onUse={useTemplate} />
                    <HomeProjects projects={visibleProjects} hydrated={hydrated} query={query} onBlank={onBlank} />
                </div>
                {query && (
                    <section className="home-search-assets">
                        <div className="studio-section-header">
                            <h2>相关素材</h2>
                            <span className="studio-muted">点击引用到创作区</span>
                        </div>
                        {assets
                            .filter((a) => `${a.title} ${a.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()))
                            .slice(0, 6)
                            .map((asset) => (
                                <button
                                    type="button"
                                    className="studio-button"
                                    key={asset.id}
                                    onClick={() => {
                                        addPendingAsset(assetPayload(asset));
                                        creationRef.current?.scrollIntoView({ behavior: "smooth" });
                                    }}
                                >
                                    <FolderOpen />
                                    {asset.title}
                                    <ArrowRight />
                                </button>
                            ))}
                        {!assets.some((a) => `${a.title} ${a.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())) && <p className="studio-muted">没有找到相关素材</p>}
                    </section>
                )}
                <HomeShowcase query={query} />
                <HomeQueue projects={projects} />
            </div>
            <AssetPickerModal
                open={assetPickerOpen}
                defaultTab="my-assets"
                onInsert={(payload) => {
                    addPendingAsset(payload);
                    setAssetPickerOpen(false);
                }}
                onClose={() => setAssetPickerOpen(false)}
            />
        </main>
    );
}

export default function IndexPage() {
    return (
        <Suspense
            fallback={
                <main className="home-page">
                    <div className="home-content studio-muted">正在打开创作工作室…</div>
                </main>
            }
        >
            <HomePageContent />
        </Suspense>
    );
}
