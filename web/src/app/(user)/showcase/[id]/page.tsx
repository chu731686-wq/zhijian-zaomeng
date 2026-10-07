"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Modal } from "antd";
import { ArrowLeft, Bot, FolderOpen, Maximize, Minus, Plus, X } from "lucide-react";
import { getShowcaseProject } from "@/services/api/showcase";
import { ensureFileSession } from "@/services/api/file-session";
import { useUserStore } from "@/stores/use-user-store";
import { InfiniteCanvas } from "../../canvas/components/infinite-canvas";
import { CanvasNodePromptPanel } from "../../canvas/components/canvas-node-prompt-panel";
import { CanvasAssistantHistoryPanel } from "../../canvas/components/canvas-assistant-panel";
import { showcaseMedia, showcaseReferences } from "../../canvas/utils/canvas-showcase";
import { imagePreviewUrl } from "@/services/image-storage";
import { CanvasNode } from "../../canvas/components/canvas-node";
import { ConnectionPath } from "../../canvas/components/canvas-connections";
import { computeFitViewport } from "../../canvas/utils/canvas-fit";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "../../canvas/types";
import type { CanvasProject } from "../../canvas/stores/use-canvas-store";

const noop = () => {};

export default function ShowcasePage() {
    const { id } = useParams<{ id: string }>();
    const token = useUserStore((state) => state.token);
    const containerRef = useRef<HTMLDivElement>(null);
    const [project, setProject] = useState<CanvasProject | null>(null);
    const [owner, setOwner] = useState("");
    const [error, setError] = useState("");
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [sidebar, setSidebar] = useState<"assets" | "chat" | null>("chat");
    const [preview, setPreview] = useState<CanvasNodeData | null>(null);
    const fitted = useRef(false);
    useEffect(() => {
        let active = true;
        fitted.current = false;
        setProject(null);
        setPreview(null);
        setSelectedId(null);
        setOwner("");
        setError("");
        if (!token) return;
        const load = async () => {
            try {
                await ensureFileSession(token);
                const result = await getShowcaseProject(id, token);
                if (!active) return;
                setProject(showcaseMedia(result.project));
                setOwner(result.ownerName);
                setError("");
            } catch (error) {
                if (active) { setProject(null); setPreview(null); setSelectedId(null); setError(error instanceof Error ? error.message : "作品加载失败"); }
            }
        };
        void load();
        const timer = window.setInterval(() => void load(), 30000);
        window.addEventListener("focus", load);
        return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", load); };
    }, [id, token]);
    const fit = useCallback(() => {
        const container = containerRef.current;
        if (!container || !project) return;
        setViewport(computeFitViewport(project.nodes.map((node) => ({ ...node.position, width: node.width, height: node.height })), { width: container.clientWidth, height: container.clientHeight }, { left: 0, right: 0, top: 0, bottom: 0 }));
    }, [project]);
    useEffect(() => { if (project && !fitted.current) { fitted.current = true; fit(); } }, [project, fit]);
    const zoom = (factor: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setViewport((current) => {
            const k = Math.min(2, Math.max(0.1, current.k * factor));
            return { k, x: rect.width / 2 - (rect.width / 2 - current.x) * k / current.k, y: rect.height / 2 - (rect.height / 2 - current.y) * k / current.k };
        });
    };
    const nodesByID = useMemo(() => new Map(project?.nodes.map((node) => [node.id, node])), [project]);
    const viewMedia = (url: string, kind: string, title: string) => setPreview({ id: url, title, type: kind as CanvasNodeType, position: { x: 0, y: 0 }, width: 0, height: 0, metadata: { content: url } });
    const selectNode = (node: CanvasNodeData) => {
        if (node.type === CanvasNodeType.Group) return;
        if (node.type === CanvasNodeType.Text) { setSelectedId(null); setPreview(node); }
        else setSelectedId(node.id);
    };
    const focusNode = (nodeId: string) => {
        const node = nodesByID.get(nodeId);
        const container = containerRef.current;
        if (!node || !container) return;
        const k = Math.min(1, Math.max(0.1, Math.min((container.clientWidth - 80) / node.width, (container.clientHeight - 120) / node.height)));
        setViewport({ k, x: container.clientWidth / 2 - (node.position.x + node.width / 2) * k, y: container.clientHeight / 2 - (node.position.y + node.height / 2) * k });
        selectNode(node);
    };
    const assetGroups = useMemo(() => {
        const groups = new Map<string, { category: string; title: string; nodes: CanvasNodeData[] }>();
        for (const node of project?.nodes || []) {
            if (![CanvasNodeType.Image, CanvasNodeType.Panorama, CanvasNodeType.Video].includes(node.type) || !node.metadata?.content) continue;
            const group = nodesByID.get(node.metadata.groupId || "");
            const visited = new Set<string>();
            let category = node.metadata.category || group?.metadata?.category;
            let parent = group;
            while (parent && !category && !visited.has(parent.id)) {
                visited.add(parent.id);
                parent = nodesByID.get(parent.metadata?.groupId || "");
                category = parent?.metadata?.category;
            }
            category ||= "其他";
            const key = `${category}:${group?.id || "ungrouped"}`;
            if (!groups.has(key)) groups.set(key, { category, title: group?.title || "未分组", nodes: [] });
            groups.get(key)!.nodes.push(node);
        }
        return ["人物", "场景", "道具", "分集", "其他"].flatMap((category) => Array.from(groups.values()).filter((group) => group.category === category));
    }, [project, nodesByID]);
    return <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
        <header className="flex min-h-14 shrink-0 items-center gap-4 border-b border-line px-5">
            <Link href="/" className="studio-text-link"><ArrowLeft size={16} />返回首页</Link>
            <span>作品展示 · 只读 · 作者 {owner || "…"}</span>
            <strong className="min-w-0 flex-1 truncate">{project?.title}</strong>
            <button className="studio-text-link" aria-pressed={sidebar === "assets"} onClick={() => setSidebar(sidebar === "assets" ? null : "assets")}><FolderOpen size={16} />资产</button>
            <button className="studio-text-link" aria-pressed={sidebar === "chat"} onClick={() => setSidebar(sidebar === "chat" ? null : "chat")}><Bot size={16} />助手聊天记录</button>
        </header>
        {!token ? <div className="studio-empty-state"><p>登录后即可查看作品展示</p><Link href="/login" className="studio-button">去登录</Link></div> : error ? <div className="studio-empty-state"><p role="alert">{error}</p><Link href="/">返回首页</Link></div> : !project ? <div className="studio-empty-state">正在加载作品…</div> : <section className="flex min-h-0 flex-1 overflow-hidden">
            <div className="relative min-w-0 flex-1">
            <InfiniteCanvas readOnly containerRef={containerRef} viewport={viewport} tool="select" backgroundMode="dots" onCanvasDeselect={() => setSelectedId(null)} onViewportChange={setViewport}>
                <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", zIndex: 6 }}>
                    {(project.connections || []).map((connection) => {
                        const from = nodesByID.get(connection.fromNodeId), to = nodesByID.get(connection.toNodeId);
                        return from && to ? <ConnectionPath key={connection.id} connection={connection} from={from} to={to} active={false} onSelect={noop} /> : null;
                    })}
                </svg>
                {project.nodes.map((node) => <CanvasNode key={node.id} readOnly data={node} scale={viewport.k} isSelected={selectedId === node.id} isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={false} showPanel={selectedId === node.id} showImageInfo={false} modelUnavailable={false} groupChildCount={project.nodes.filter((child) => child.metadata?.groupId === node.id).length} onMouseDown={noop} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop} onResize={noop} onContentChange={noop} onTitleChange={noop} onReadOnlySelect={selectNode} onViewImage={setPreview} renderPanel={(panelNode) => <CanvasNodePromptPanel readOnly node={panelNode} isRunning={false} materialReferences={showcaseReferences(panelNode, project.nodes, project.connections || [])} onViewReference={(reference) => viewMedia(reference.url, reference.kind, reference.title)} onPromptChange={noop} onConfigChange={noop} onGenerate={noop} onAddMaterials={noop} onRemoveMaterial={noop} />} onContextMenu={(event) => event.preventDefault()} />)}
            </InfiniteCanvas>
            <div data-canvas-no-zoom className="absolute bottom-5 right-5 flex items-center gap-2 rounded-xl border border-line bg-surface p-2">
                <button className="studio-icon-button" aria-label="缩小" onClick={() => zoom(1 / 1.2)}><Minus /></button>
                <span className="text-sm">{Math.round(viewport.k * 100)}%</span>
                <button className="studio-icon-button" aria-label="放大" onClick={() => zoom(1.2)}><Plus /></button>
                <button className="studio-icon-button" aria-label="适应画布" onClick={fit}><Maximize /></button>
            </div>
            </div>
            {sidebar ? <aside className="flex w-[380px] max-w-[45vw] shrink-0 flex-col border-l border-line bg-surface" aria-label={sidebar === "assets" ? "作品资产" : "助手聊天记录"}>
                <div className="flex shrink-0 justify-end px-3 pt-2"><button className="studio-icon-button" aria-label="关闭侧栏" onClick={() => setSidebar(null)}><X size={16} /></button></div>
                {sidebar === "chat" ? <CanvasAssistantHistoryPanel key={project.id} sessions={project.chatSessions || []} activeSessionId={project.activeChatId} nodes={project.nodes} onFocusNode={focusNode} onViewMedia={viewMedia} /> : <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                    <h2 className="mb-4 text-sm">资产 · {assetGroups.reduce((count, group) => count + group.nodes.length, 0)} 项</h2>
                    {!assetGroups.length ? <p className="text-sm text-muted-text">暂无图片或视频资产</p> : null}
                    {assetGroups.map((group) => <section key={`${group.category}:${group.title}:${group.nodes[0]?.id}`} className="mb-5"><h3 className="mb-2 text-sm text-muted-text">{group.category} / {group.title}</h3><div className="grid grid-cols-2 gap-2">{group.nodes.map((node) => <button key={node.id} className="overflow-hidden rounded-lg border border-line p-2 text-left hover:bg-hover" onClick={() => { focusNode(node.id); setPreview(node); }}>
                        {node.type === CanvasNodeType.Video ? <video src={node.metadata?.content} muted playsInline preload="metadata" className="h-24 w-full object-contain" /> : <img src={imagePreviewUrl(node.metadata?.content || "", 512, node.metadata?.storageKey)} alt={node.title} loading="lazy" className="h-24 w-full object-contain" />}<span className="mt-2 block truncate text-xs">{node.title}</span>
                    </button>)}</div></section>)}
                </div>}
            </aside> : null}
        </section>}
        <Modal open={Boolean(preview)} title={preview?.title} footer={null} width="90vw" onCancel={() => setPreview(null)} destroyOnHidden>
            {preview?.type === CanvasNodeType.Text ? <textarea readOnly aria-label="文本内容（只读）" value={preview.metadata?.content || ""} className="h-[65vh] w-full resize-none select-text bg-transparent text-foreground outline-none" /> : preview?.type === CanvasNodeType.Audio ? <audio src={preview.metadata?.content} controls /> : preview?.type === CanvasNodeType.Video ? <video key={preview.id} src={preview.metadata?.content} preload="metadata" controls playsInline className="max-h-[80vh] w-full" /> : preview ? <img src={preview.metadata?.content} alt={preview.title} className="max-h-[80vh] w-full object-contain" /> : null}
        </Modal>
    </main>;
}
