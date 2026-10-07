"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Modal } from "antd";
import { ArrowLeft, Maximize, Minus, Plus } from "lucide-react";
import { getShowcaseProject } from "@/services/api/showcase";
import { ensureFileSession } from "@/services/api/file-session";
import { useUserStore } from "@/stores/use-user-store";
import { InfiniteCanvas } from "../../canvas/components/infinite-canvas";
import { CanvasNode } from "../../canvas/components/canvas-node";
import { ConnectionPath } from "../../canvas/components/canvas-connections";
import { computeFitViewport } from "../../canvas/utils/canvas-fit";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "../../canvas/types";
import type { CanvasProject } from "../../canvas/stores/use-canvas-store";

const noop = () => {};
function displayNode(node: CanvasNodeData): CanvasNodeData {
    const key = node.metadata?.storageKey;
    if (!key?.startsWith("server:") || key.startsWith("server:webdav:")) return node;
    return { ...node, metadata: { ...node.metadata, content: `/api/files/${encodeURIComponent(key.slice(7))}/content` } };
}

export default function ShowcasePage() {
    const { id } = useParams<{ id: string }>();
    const token = useUserStore((state) => state.token);
    const containerRef = useRef<HTMLDivElement>(null);
    const [project, setProject] = useState<CanvasProject | null>(null);
    const [owner, setOwner] = useState("");
    const [error, setError] = useState("");
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [preview, setPreview] = useState<CanvasNodeData | null>(null);
    const fitted = useRef(false);
    useEffect(() => {
        let active = true;
        fitted.current = false;
        setProject(null);
        setPreview(null);
        setOwner("");
        setError("");
        if (!token) return;
        const load = async () => {
            try {
                await ensureFileSession(token);
                const result = await getShowcaseProject(id, token);
                if (!active) return;
                setProject({ ...result.project, nodes: result.project.nodes.map(displayNode) });
                setOwner(result.ownerName);
                setError("");
            } catch (error) {
                if (active) { setProject(null); setPreview(null); setError(error instanceof Error ? error.message : "作品加载失败"); }
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
    const nodesByID = new Map(project?.nodes.map((node) => [node.id, node]));
    return <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
        <header className="flex min-h-14 shrink-0 items-center gap-4 border-b border-line px-5">
            <Link href="/" className="studio-text-link"><ArrowLeft size={16} />返回首页</Link>
            <span>作品展示 · 只读 · 作者 {owner || "…"}</span>
            <strong className="min-w-0 truncate">{project?.title}</strong>
        </header>
        {!token ? <div className="studio-empty-state"><p>登录后即可查看作品展示</p><Link href="/login" className="studio-button">去登录</Link></div> : error ? <div className="studio-empty-state"><p role="alert">{error}</p><Link href="/">返回首页</Link></div> : !project ? <div className="studio-empty-state">正在加载作品…</div> : <section className="relative min-h-0 flex-1">
            <InfiniteCanvas readOnly containerRef={containerRef} viewport={viewport} tool="pan" backgroundMode={project.backgroundMode || "dots"} onViewportChange={setViewport}>
                <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", zIndex: 6 }}>
                    {(project.connections || []).map((connection) => {
                        const from = nodesByID.get(connection.fromNodeId), to = nodesByID.get(connection.toNodeId);
                        return from && to ? <ConnectionPath key={connection.id} connection={connection} from={from} to={to} active={false} onSelect={noop} /> : null;
                    })}
                </svg>
                {project.nodes.map((node) => <CanvasNode key={node.id} readOnly data={node} scale={viewport.k} isSelected={false} isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={false} showPanel={false} showImageInfo={false} modelUnavailable={false} groupChildCount={project.nodes.filter((child) => child.metadata?.groupId === node.id).length} onMouseDown={noop} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop} onResize={noop} onContentChange={noop} onTitleChange={noop} onViewImage={setPreview} onContextMenu={(event) => event.preventDefault()} />)}
            </InfiniteCanvas>
            <div data-canvas-no-zoom className="absolute bottom-5 right-5 flex items-center gap-2 rounded-xl border border-line bg-surface p-2">
                <button className="studio-icon-button" aria-label="缩小" onClick={() => zoom(1 / 1.2)}><Minus /></button>
                <span className="text-sm">{Math.round(viewport.k * 100)}%</span>
                <button className="studio-icon-button" aria-label="放大" onClick={() => zoom(1.2)}><Plus /></button>
                <button className="studio-icon-button" aria-label="适应画布" onClick={fit}><Maximize /></button>
            </div>
        </section>}
        <Modal open={Boolean(preview)} title={preview?.title} footer={null} width="90vw" onCancel={() => setPreview(null)} destroyOnHidden>
            {preview?.type === CanvasNodeType.Video ? <video key={preview.id} src={preview.metadata?.content} preload="metadata" controls playsInline className="max-h-[80vh] w-full" /> : preview ? <img src={preview.metadata?.content} alt={preview.title} className="max-h-[80vh] w-full object-contain" /> : null}
        </Modal>
    </main>;
}
