"use client";

import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { App, Empty, Input, Modal, Pagination, Select, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, Clapperboard, Download, Eye, FileText, FolderPlus, Group, Image as ImageIcon, Music2, Pencil, Plus, Search, Settings2, Trash2, Type, Video, X } from "lucide-react";
import { motion } from "motion/react";

import { imagePreviewUrl } from "@/services/image-storage";
import { AssetFormModal } from "@/components/assets/asset-form-modal";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { fetchAssetLibrary, type AssetLibraryItem } from "@/services/api/assets";
import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { getTeams, type Team } from "@/services/api/team";
import { createTeamAsset, deleteTeamAsset, getTeamAssets, updateTeamAsset, type TeamAsset, type TeamAssetCategory } from "@/services/api/team-assets";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { isCanvasImageNodeType } from "../utils/canvas-panorama";
import type { InsertAssetPayload } from "./asset-picker-modal";

export const CANVAS_ASSET_DRAG_TYPE = "application/x-infinite-canvas-asset";

const PANEL_MOTION_SECONDS = 0.5;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_MIN_WIDTH = 220;
const PANEL_MAX_WIDTH = 480;
const ASSET_PAGE_SIZE = 12;
const PROMPT_CACHE_TIME = 24 * 60 * 60 * 1000;
const TEAM_ASSET_REQUEST_EVENT = "canvas:team-asset-request";
const TEAM_ASSET_CATEGORIES: TeamAssetCategory[] = ["人物", "场景", "道具", "分集", "其他"];

type PanelTab = "canvas" | "assets";

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    open: boolean;
    width: number;
    onWidthChange: (width: number) => void;
    onFocusNode: (nodeId: string) => void;
    onAssetDragStart: (payload: InsertAssetPayload) => void;
    onAssetDragEnd: () => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

const NODE_TYPE_ICON = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Panorama]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Config]: Settings2,
    [CanvasNodeType.Director]: Clapperboard,
    [CanvasNodeType.Group]: Group,
};

const NODE_TYPE_LABEL = {
    [CanvasNodeType.Image]: "图片",
    [CanvasNodeType.Panorama]: "全景图",
    [CanvasNodeType.Video]: "视频",
    [CanvasNodeType.Audio]: "音频",
    [CanvasNodeType.Text]: "文本",
    [CanvasNodeType.Config]: "生成配置",
    [CanvasNodeType.Director]: "导演台",
    [CanvasNodeType.Group]: "组",
};

const NODE_FILTER_OPTIONS = [
    { label: "全部", value: "all" },
    { label: "图片", value: CanvasNodeType.Image },
    { label: "全景图", value: CanvasNodeType.Panorama },
    { label: "文本", value: CanvasNodeType.Text },
    { label: "配置", value: CanvasNodeType.Config },
    { label: "视频", value: CanvasNodeType.Video },
    { label: "音频", value: CanvasNodeType.Audio },
    { label: "导演台", value: CanvasNodeType.Director },
    { label: "组", value: CanvasNodeType.Group },
];

const ASSET_TYPE_OPTIONS = [
    { label: "全部", value: "" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

const STATUS_COLOR: Record<string, string> = {
    success: canvasThemes.dark.status.success,
    loading: canvasThemes.dark.status.loading,
    error: canvasThemes.dark.status.error,
};

export function CanvasSidePanel({ nodes, selectedNodeIds, open, width, onWidthChange, onFocusNode, onAssetDragStart, onAssetDragEnd, onInsertAsset, onClose }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<PanelTab>("assets");
    const [mounted, setMounted] = useState(open);
    const [closing, setClosing] = useState(false);
    const [resizing, setResizing] = useState(false);
    const [teamAssetSource, setTeamAssetSource] = useState<TeamAssetSource | null>(null);

    useEffect(() => {
        const handleRequest = (event: Event) => {
            const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
            const node = nodes.find((item) => item.id === nodeId);
            if (node) setTeamAssetSource(sourceFromNode(node));
        };
        window.addEventListener(TEAM_ASSET_REQUEST_EVENT, handleRequest);
        return () => window.removeEventListener(TEAM_ASSET_REQUEST_EVENT, handleRequest);
    }, [nodes]);

    useEffect(() => {
        if (open) {
            setTab("assets");
            setMounted(true);
            setClosing(false);
            return;
        }
        setClosing(true);
        const timer = window.setTimeout(() => {
            setMounted(false);
            setClosing(false);
        }, PANEL_MOTION_SECONDS * 1000);
        return () => window.clearTimeout(timer);
    }, [open]);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        const onMove = (moveEvent: PointerEvent) => onWidthChange(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX)));
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    return (
        <>
            {mounted ? (
                <motion.div
                    className="relative z-[60] flex h-full shrink-0"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: open ? width + 1 : 0, opacity: open ? 1 : 0 }}
                    transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                    style={{ overflow: "clip", pointerEvents: closing ? "none" : undefined }}
                >
                    <motion.aside
                        className="relative flex h-full shrink-0 flex-col overflow-hidden border-r"
                        initial={{ x: -48 }}
                        animate={{ x: closing ? -28 : 0 }}
                        transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                        style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                        data-canvas-no-zoom
                    >
                        <div className="flex items-center gap-5 px-4 pt-3.5">
                            <PanelTabButton label="画布" active={tab === "canvas"} theme={theme} onClick={() => setTab("canvas")} />
                            <PanelTabButton label="素材库" active={tab === "assets"} theme={theme} onClick={() => setTab("assets")} />
                        </div>
                        <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                            {tab === "canvas" ? (
                                <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} theme={theme} />
                            ) : (
                                <CanvasAssetsTab theme={theme} onClose={onClose} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} onInsertAsset={onInsertAsset} onPutInTeamAsset={setTeamAssetSource} />
                            )}
                        </div>
                        <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整左侧面板宽度" />
                    </motion.aside>
                </motion.div>
            ) : null}
            <TeamAssetForm source={teamAssetSource} onClose={() => setTeamAssetSource(null)} />
        </>
    );
}

function PanelTabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="relative pb-1.5 text-sm font-semibold transition-opacity" style={{ color: theme.node.text, opacity: active ? 1 : 0.45 }}>
            {label}
            {active ? <motion.span layoutId="sidePanelTabIndicator" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
        </button>
    );
}

function CanvasNodesTab({ nodes, selectedNodeIds, onFocusNode, theme }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; theme: CanvasTheme }) {
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => {
            if (typeFilter !== "all" && node.type !== typeFilter) return false;
            return !query || [node.title, NODE_TYPE_LABEL[node.type], node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query);
        });
    }, [keyword, nodes, typeFilter]);
    const treeRows = useMemo(() => {
        const filteredIds = new Set(filtered.map((node) => node.id));
        const groups = new Set(nodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
        const children = new Map<string, CanvasNodeData[]>();
        filtered.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId && groups.has(groupId)) children.set(groupId, [...(children.get(groupId) || []), node]);
        });
        return nodes.flatMap((node) => {
            if (node.metadata?.groupId && groups.has(node.metadata.groupId)) return [];
            if (node.type !== CanvasNodeType.Group) return filteredIds.has(node.id) ? [{ node, depth: 0, hasChildren: false }] : [];
            const groupChildren = children.get(node.id) || [];
            if (!filteredIds.has(node.id) && !groupChildren.length) return [];
            return [{ node, depth: 0, hasChildren: groupChildren.length > 0 }, ...(collapsedGroups.has(node.id) ? [] : groupChildren.map((child) => ({ node: child, depth: 1, hasChildren: false })))];
        });
    }, [collapsedGroups, filtered, nodes]);

    useEffect(() => {
        const selectedId = Array.from(selectedNodeIds)[0];
        if (selectedId) rowRefs.current[selectedId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selectedNodeIds]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                <span className="text-xs font-medium opacity-60">画布元素</span>
                <span className="text-xs opacity-35">{nodes.length}</span>
                <Select size="small" variant="borderless" className="w-auto" popupMatchSelectWidth={false} value={typeFilter} onChange={setTypeFilter} options={NODE_FILTER_OPTIONS} />
            </div>
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-muted-text" />} placeholder="搜索节点" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {treeRows.length ? (
                    <div className="space-y-1.5">
                        {treeRows.map(({ node, depth, hasChildren }) => {
                            const Icon = NODE_TYPE_ICON[node.type] || FileText;
                            const hasImage = isCanvasImageNodeType(node.type) && node.metadata?.content;
                            const active = selectedNodeIds.has(node.id);
                            return (
                                <div key={node.id} className={cn("relative flex items-center rounded-lg transition", depth && "ml-5", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")} style={active ? { background: theme.toolbar.activeBg } : undefined}>
                                    {depth ? <span className="pointer-events-none absolute -left-3 top-[calc(-50%-0.4rem)] h-[calc(100%+0.4rem)] w-3 rounded-bl-md border-b border-l opacity-45" style={{ borderColor: theme.node.stroke }} /> : null}
                                    {node.type === CanvasNodeType.Group && hasChildren ? (
                                        <button type="button" onClick={() => setCollapsedGroups((current) => (current.has(node.id) ? new Set([...current].filter((id) => id !== node.id)) : new Set(current).add(node.id)))} className="ml-1 grid size-6 shrink-0 place-items-center opacity-55 transition hover:opacity-100" aria-label={node.title}>
                                            <ChevronRight className={cn("size-3.5 transition-transform", !collapsedGroups.has(node.id) && "rotate-90")} />
                                        </button>
                                    ) : null}
                                    <button
                                        ref={(element) => {
                                            rowRefs.current[node.id] = element;
                                        }}
                                        type="button"
                                        onClick={() => onFocusNode(node.id)}
                                        className={cn("flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 text-left", node.type === CanvasNodeType.Group && hasChildren ? "pl-0" : "pl-2")}
                                    >
                                        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md">
                                            {hasImage ? <img decoding="async" src={imagePreviewUrl(node.metadata?.content || "", 512, node.metadata?.storageKey)} loading="lazy" alt={node.title} className="size-full bg-bg object-contain" /> : <Icon className="size-5 opacity-60" />}
                                        </span>
                                        <span className="min-w-0 flex-1 space-y-0.5">
                                            <span className="block truncate text-sm font-medium leading-snug">{node.title || NODE_TYPE_LABEL[node.type] || "未命名节点"}</span>
                                            <span className="block truncate text-xs leading-snug opacity-50">{node.type === CanvasNodeType.Text ? node.metadata?.content || node.metadata?.prompt || "" : NODE_TYPE_LABEL[node.type] || node.type}</span>
                                        </span>
                                        {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" aria-label={{ success: "已完成", loading: "生成中", error: "出错" }[node.metadata.status]} title={{ success: "已完成", loading: "生成中", error: "出错" }[node.metadata.status]} style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="pt-16 text-center text-sm opacity-40">{nodes.length ? "无匹配节点" : "画布暂无节点"}</div>
                )}
            </div>
        </div>
    );
}

const CanvasAssetsTab = memo(function CanvasAssetsTab({ theme, onClose, onAssetDragStart, onAssetDragEnd, onInsertAsset, onPutInTeamAsset }: { theme: CanvasTheme; onClose: () => void; onAssetDragStart: (payload: InsertAssetPayload) => void; onAssetDragEnd: () => void; onInsertAsset: (payload: InsertAssetPayload) => void; onPutInTeamAsset: (source: TeamAssetSource) => void }) {
    const [activeTab, setActiveTab] = useState<"mine" | "team">("mine");
    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-4 pb-3 pt-1">
                <div className="flex items-center gap-4"><button type="button" className="text-sm font-semibold" style={{ opacity: activeTab === "mine" ? 1 : 0.5 }} onClick={() => setActiveTab("mine")}>我的素材</button><button type="button" className="text-sm font-semibold" style={{ opacity: activeTab === "team" ? 1 : 0.5 }} onClick={() => setActiveTab("team")}>团队</button></div>
                <button type="button" className="grid size-8 place-items-center rounded-lg opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" onClick={onClose} aria-label="关闭素材库"><X className="size-4" /></button>
            </div>
            {activeTab === "mine" ? <MyAssetsTab theme={theme} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} onPutInTeamAsset={onPutInTeamAsset} /> : <TeamAssetsTab theme={theme} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} onInsertAsset={onInsertAsset} />}
        </div>
    );
});

function MyAssetsTab({ theme, onAssetDragStart, onAssetDragEnd, onPutInTeamAsset }: { theme: CanvasTheme; onAssetDragStart: (payload: InsertAssetPayload) => void; onAssetDragEnd: () => void; onPutInTeamAsset: (source: TeamAssetSource) => void }) {
    const assets = useAssetStore((state) => state.assets);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const teamQuery = useQuery({ queryKey: ["canvas-team-assets-memberships", token], queryFn: () => getTeams(token), enabled: Boolean(token), retry: false });
    const [keyword, setKeyword] = useState("");
    const [type, setType] = useState<"all" | "image" | "video" | "character">("all");
    const [page, setPage] = useState(1);
    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => {
            const isCharacter = asset.category === "角色" || asset.tags.includes("角色");
            const matchesType = type === "all" || (type === "character" ? isCharacter : asset.kind === type);
            return matchesType && (!query || [asset.title, asset.category || "", ...(asset.tags || [])].join(" ").toLowerCase().includes(query));
        });
    }, [assets, keyword, type]);
    const items = filtered.slice((page - 1) * ASSET_PAGE_SIZE, page * ASSET_PAGE_SIZE);

    useEffect(() => setPage((value) => Math.min(value, Math.max(1, Math.ceil(filtered.length / ASSET_PAGE_SIZE)))), [filtered.length]);
    useEffect(() => setPage(1), [keyword, type]);

    const confirmRemove = (asset: Asset) => Modal.confirm({
        title: `删除「${asset.title}」？`,
        content: "删除后将从素材库移除。",
        okText: "删除",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => { removeAsset(asset.id); message.success("已删除"); },
    });

    return (
        <>
            <div className="px-3 pb-3">
                <Input size="middle" allowClear prefix={<Search className="size-3.5 opacity-50" />} placeholder="搜索素材" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </div>
            <div className="flex items-center gap-1.5 px-3 pb-3">
                {([{ label: "全部", value: "all" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "角色", value: "character" }] as const).map((option) => <button type="button" key={option.value} onClick={() => setType(option.value)} className="rounded-full px-3 py-1.5 text-xs font-medium transition" style={{ color: theme.node.text, background: type === option.value ? theme.toolbar.activeBg : "transparent", opacity: type === option.value ? 1 : 0.6 }}>{option.label}</button>)}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {filtered.length ? <div className="grid grid-cols-2 gap-3 px-1 pt-1">{items.map((asset) => <AssetLibraryCard key={asset.id} asset={asset} theme={theme} onDelete={() => confirmRemove(asset)} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} canPutInTeam={Boolean(teamQuery.data?.some((team) => team.role !== "viewer"))} onPutInTeam={() => onPutInTeamAsset(sourceFromAsset(asset))} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无素材" className="pt-16" />}
                {filtered.length > ASSET_PAGE_SIZE ? <Pagination className="!mt-3 flex justify-center" size="small" current={page} pageSize={ASSET_PAGE_SIZE} total={filtered.length} showSizeChanger={false} onChange={setPage} /> : null}
            </div>
        </>
    );
}

function AssetLibraryCard({ asset, theme, onDelete, onAssetDragStart, onAssetDragEnd, canPutInTeam, onPutInTeam }: { asset: Asset; theme: CanvasTheme; onDelete: () => void; onAssetDragStart: (payload: InsertAssetPayload) => void; onAssetDragEnd: () => void; canPutInTeam: boolean; onPutInTeam: () => void }) {
    const imageUrl = asset.kind === "image" ? asset.data.dataUrl || asset.coverUrl : asset.coverUrl;
    const mediaUrl = asset.kind === "video" || asset.kind === "audio" ? asset.data.url : imageUrl;
    const dimensions = asset.kind === "image" || asset.kind === "video" ? `${asset.data.width}×${asset.data.height}` : asset.kind === "audio" ? "音频" : "文本";
    const typeLabel = asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "文本";

    return (
        <article
            draggable
            onDragStart={(event) => {
                event.dataTransfer.setData(CANVAS_ASSET_DRAG_TYPE, "asset");
                event.dataTransfer.effectAllowed = "copy";
                onAssetDragStart(assetPayload(asset));
            }}
            onDragEnd={onAssetDragEnd}
            className="group min-w-0 cursor-grab active:cursor-grabbing"
            title={asset.title}
        >
            <div className="relative aspect-square overflow-hidden rounded-lg" style={{ background: "#0A0A0C" }}>
                {asset.kind === "image" && mediaUrl ? <img decoding="async" src={imagePreviewUrl(mediaUrl, 512, asset.kind === "image" ? asset.data.storageKey : undefined)} loading="lazy" alt={asset.title} className="size-full object-contain" draggable={false} /> : null}
                {asset.kind === "video" && mediaUrl ? <video src={`${mediaUrl}#t=0.1`} muted playsInline preload="metadata" className="size-full object-contain" /> : null}
                {asset.kind === "audio" ? <span className="grid size-full place-items-center"><Music2 className="size-8 opacity-45" /></span> : null}
                {asset.kind === "text" ? <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-3 text-xs leading-5 opacity-80">{asset.data.content}</div> : null}
                <div className="absolute left-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <button type="button" className="grid size-full place-items-center" aria-label={`删除${asset.title}`} onClick={(event) => { event.stopPropagation(); onDelete(); }} onPointerDown={(event) => event.stopPropagation()}><Trash2 className="size-3.5" /></button>
                </div>
                <div className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <a href={mediaUrl || "#"} download={asset.title} className="grid size-full place-items-center" aria-label={`下载${asset.title}`} onClick={(event) => { event.stopPropagation(); if (!mediaUrl) event.preventDefault(); }} onPointerDown={(event) => event.stopPropagation()}><Download className="size-3.5" /></a>
                </div>
                {canPutInTeam ? <button type="button" className="absolute bottom-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100" aria-label={`放进团队资产库：${asset.title}`} title="放进团队资产库" onClick={(event) => { event.stopPropagation(); onPutInTeam(); }} onPointerDown={(event) => event.stopPropagation()}><FolderPlus className="size-3.5" /></button> : null}
            </div>
            <div className="mt-2 line-clamp-2 min-h-10 break-words text-xs font-medium leading-5" style={{ color: theme.node.text }}>{asset.title || "未命名素材"}</div>
            <div className="truncate text-[11px] leading-4 opacity-50" style={{ color: theme.node.text }}>{dimensions} · {typeLabel}</div>
        </article>
    );
}

type TeamAssetSource = { kind: "text" | "image" | "video" | "audio"; name: string; url?: string; text?: string; storageKey?: string; category?: string };

function sourceFromAsset(asset: Asset): TeamAssetSource {
    if (asset.kind === "text") return { kind: "text", name: asset.title, text: asset.data.content, category: asset.category };
    if (asset.kind === "image") return { kind: "image", name: asset.title, url: asset.data.dataUrl, storageKey: asset.data.storageKey, category: asset.category };
    if (asset.kind === "video") return { kind: "video", name: asset.title, url: asset.data.url, storageKey: asset.data.storageKey, category: asset.category };
    return { kind: "audio", name: asset.title, url: asset.data.url, storageKey: asset.data.storageKey, category: asset.category };
}

function sourceFromNode(node: CanvasNodeData): TeamAssetSource | null {
    const meta = node.metadata || {};
    if (node.type === CanvasNodeType.Text) return { kind: "text", name: node.title || "未命名节点", text: meta.content || meta.prompt || "" };
    if (isCanvasImageNodeType(node.type) && typeof meta.content === "string" && meta.content) return { kind: "image", name: node.title || "未命名节点", url: meta.content, storageKey: meta.storageKey };
    if (node.type === CanvasNodeType.Video && typeof meta.content === "string" && meta.content) return { kind: "video", name: node.title || "未命名节点", url: meta.content, storageKey: meta.storageKey };
    if (node.type === CanvasNodeType.Audio && typeof meta.content === "string" && meta.content) return { kind: "audio", name: node.title || "未命名节点", url: meta.content, storageKey: meta.storageKey };
    return null;
}

function TeamAssetForm({ source, onClose }: { source: TeamAssetSource | null; onClose: () => void }) {
    const token = useUserStore((state) => state.token);
    const { message } = App.useApp();
    const [teams, setTeams] = useState<Team[]>([]);
    const [teamId, setTeamId] = useState("");
    const [category, setCategory] = useState<TeamAssetCategory>("其他");
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (!source || !token) return;
        setName(source.name || "未命名素材");
        setCategory(TEAM_ASSET_CATEGORIES.includes(source.category as TeamAssetCategory) ? source.category as TeamAssetCategory : "其他");
        void getTeams(token).then((items) => {
            const writable = items.filter((team) => team.role !== "viewer");
            setTeams(writable);
            setTeamId((current) => writable.some((team) => team.id === current) ? current : writable[0]?.id || "");
        }).catch((error) => message.error(error instanceof Error ? error.message : "团队加载失败"));
    }, [message, source, token]);
    const save = async () => {
        if (!source || !teamId || !name.trim()) return;
        setSaving(true);
        try {
            let fileUrl = source.url;
            if (source.kind !== "text" && fileUrl && !source.storageKey?.startsWith("server:") && !isServerFileUrl(fileUrl)) {
                if (source.kind === "image") fileUrl = (await uploadImage(fileUrl, { team: true, token })).url;
                else fileUrl = (await uploadMediaFile(fileUrl, `team-${source.kind}`, undefined, token, true)).url;
            }
            await createTeamAsset(token, teamId, { kind: source.kind, name: name.trim(), category, ...(source.kind === "text" ? { text_content: source.text || "" } : { file_url: fileUrl || "" }) });
            message.success("已放进团队资产库");
            onClose();
        } catch (error) { message.error(error instanceof Error ? error.message : "添加团队素材失败"); }
        finally { setSaving(false); }
    };
    return <Modal title="放进团队资产库" open={Boolean(source)} onCancel={onClose} onOk={() => void save()} confirmLoading={saving} okText="添加" cancelText="取消" destroyOnHidden>
        {source ? <div className="space-y-4 py-2">
            {teams.length ? <label className="block space-y-1.5"><span className="text-xs text-muted-text">团队</span><Select className="w-full" value={teamId || undefined} placeholder="选择团队" options={teams.map((team) => ({ label: team.name, value: team.id }))} onChange={setTeamId} /></label> : <p className="text-sm text-muted-text">还没有团队，去首页『团队』里建一个</p>}
            <label className="block space-y-1.5"><span className="text-xs text-muted-text">类别</span><Select className="w-full" value={category} options={TEAM_ASSET_CATEGORIES.map((item) => ({ label: item, value: item }))} onChange={setCategory} /></label>
            <label className="block space-y-1.5"><span className="text-xs text-muted-text">名字</span><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
        </div> : null}
    </Modal>;
}

function isServerFileUrl(url: string) { return url.startsWith("/api/files/") || url.includes("/api/files/"); }

function TeamAssetsTab({ theme, onAssetDragStart, onAssetDragEnd, onInsertAsset }: { theme: CanvasTheme; onAssetDragStart: (payload: InsertAssetPayload) => void; onAssetDragEnd: () => void; onInsertAsset: (payload: InsertAssetPayload) => void }) {
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id || "");
    const { message } = App.useApp();
    const [teams, setTeams] = useState<Team[]>([]);
    const [teamId, setTeamId] = useState("");
    const [category, setCategory] = useState<TeamAssetCategory | "">("");
    const [assets, setAssets] = useState<TeamAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<TeamAsset | null>(null);
    const [editName, setEditName] = useState("");
    const [editCategory, setEditCategory] = useState<TeamAssetCategory>("其他");
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (!token) return;
        void getTeams(token).then((items) => { setTeams(items); setTeamId((current) => items.some((team) => team.id === current) ? current : items[0]?.id || ""); }).catch((error) => message.error(error instanceof Error ? error.message : "团队加载失败"));
    }, [message, token]);
    useEffect(() => {
        if (!teamId || !token) { setAssets([]); return; }
        setLoading(true);
        void getTeamAssets(token, teamId, { category: category || undefined }).then(setAssets).catch((error) => { setAssets([]); message.error(error instanceof Error ? error.message : "团队素材加载失败"); }).finally(() => setLoading(false));
    }, [category, message, teamId, token]);
    const activeTeam = teams.find((team) => team.id === teamId);
    const canAdd = activeTeam?.role !== "viewer";
    const canManage = (asset: TeamAsset) => activeTeam?.role === "owner" || activeTeam?.role === "admin" || (activeTeam?.role === "editor" && asset.created_by === userId);
    const toPayload = (asset: TeamAsset): InsertAssetPayload => asset.kind === "text"
        ? { kind: "text", content: asset.text_content || "", title: asset.name }
        : asset.kind === "image"
          ? { kind: "image", dataUrl: asset.file_url || "", title: asset.name }
          : asset.kind === "video"
            ? { kind: "video", url: asset.file_url || "", title: asset.name }
            : { kind: "audio", url: asset.file_url || "", title: asset.name };
    const remove = async (asset: TeamAsset) => {
        try { await deleteTeamAsset(token, teamId, asset.id); setAssets((current) => current.filter((item) => item.id !== asset.id)); message.success("已删除团队素材"); }
        catch (error) { message.error(error instanceof Error ? error.message : "删除失败"); }
    };
    const saveEdit = async () => {
        if (!editing || !editName.trim()) return;
        setSaving(true);
        try {
            const updated = await updateTeamAsset(token, teamId, editing.id, { name: editName.trim(), category: editCategory });
            setAssets((current) => current.map((asset) => asset.id === updated.id ? updated : asset));
            setEditing(null);
        } catch (error) { message.error(error instanceof Error ? error.message : "修改失败"); }
        finally { setSaving(false); }
    };
    return <div className="flex min-h-0 flex-1 flex-col">
        {teams.length ? <div className="flex items-center gap-2 px-3 pb-2"><Select className="min-w-0 flex-1" size="small" value={teamId || undefined} options={teams.map((team) => ({ label: team.name, value: team.id }))} onChange={setTeamId} /><Select className="w-24" size="small" value={category} options={[{ label: "全部类别", value: "" }, ...TEAM_ASSET_CATEGORIES.map((item) => ({ label: item, value: item }))]} onChange={setCategory} /></div> : <div className="px-4 py-5 text-sm text-muted-text">还没有团队，去首页『团队』里建一个</div>}
        {teamId ? <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{loading ? <div className="flex justify-center pt-16"><Spin size="small" /></div> : assets.length ? <div className="grid grid-cols-2 gap-3 px-1 pt-1">{assets.map((asset) => <TeamAssetCard key={asset.id} asset={asset} theme={theme} canManage={canManage(asset)} onInsert={() => onInsertAsset(toPayload(asset))} onDragStart={() => onAssetDragStart(toPayload(asset))} onDragEnd={onAssetDragEnd} onEdit={() => { setEditing(asset); setEditName(asset.name); setEditCategory(asset.category); }} onDelete={() => void remove(asset)} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无团队素材" className="pt-16" />}</div> : null}
        {activeTeam && canAdd ? <div className="px-3 pb-2 text-xs text-muted-text">可从节点右键菜单或「我的素材」加入团队资产库</div> : null}
        <Modal title="编辑团队素材" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => void saveEdit()} confirmLoading={saving} okText="保存" cancelText="取消" destroyOnHidden>
            <div className="space-y-4 py-2"><Input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={120} /><Select className="w-full" value={editCategory} options={TEAM_ASSET_CATEGORIES.map((item) => ({ label: item, value: item }))} onChange={setEditCategory} /></div>
        </Modal>
    </div>;
}

function TeamAssetCard({ asset, theme, canManage, onInsert, onDragStart, onDragEnd, onEdit, onDelete }: { asset: TeamAsset; theme: CanvasTheme; canManage: boolean; onInsert: () => void; onDragStart: () => void; onDragEnd: () => void; onEdit: () => void; onDelete: () => void }) {
    const mediaUrl = asset.file_url || "";
    const typeLabel = asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "文本";
    return <article draggable onClick={onInsert} onDragStart={(event) => { event.dataTransfer.setData(CANVAS_ASSET_DRAG_TYPE, "asset"); event.dataTransfer.effectAllowed = "copy"; onDragStart(); }} onDragEnd={onDragEnd} className="group min-w-0 cursor-grab active:cursor-grabbing" title={`${asset.name} · ${asset.category}`}>
        <div className="relative aspect-square overflow-hidden rounded-lg" style={{ background: theme.node.preview }}>
            {asset.kind === "image" && mediaUrl ? <img decoding="async" src={imagePreviewUrl(mediaUrl)} alt={asset.name} className="size-full object-contain" draggable={false} /> : null}
            {asset.kind === "video" && mediaUrl ? <video src={`${mediaUrl}#t=0.1`} muted playsInline preload="metadata" className="size-full object-contain" /> : null}
            {asset.kind === "audio" ? <span className="grid size-full place-items-center"><Music2 className="size-8 opacity-45" /></span> : null}
            {asset.kind === "text" ? <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-3 text-xs leading-5 opacity-80">{asset.text_content}</div> : null}
            {canManage ? <div className="absolute right-1.5 top-1.5 flex gap-1"><button type="button" className="grid size-7 place-items-center rounded-full bg-black/60 text-white" aria-label={`改名或分类：${asset.name}`} onClick={(event) => { event.stopPropagation(); onEdit(); }} onPointerDown={(event) => event.stopPropagation()}><Pencil className="size-3.5" /></button><button type="button" className="grid size-7 place-items-center rounded-full bg-black/60 text-white" aria-label={`删除${asset.name}`} onClick={(event) => { event.stopPropagation(); onDelete(); }} onPointerDown={(event) => event.stopPropagation()}><Trash2 className="size-3.5" /></button></div> : null}
        </div>
        <div className="mt-2 line-clamp-2 min-h-10 break-words text-xs font-medium leading-5" style={{ color: theme.node.text }}>{asset.name || "未命名素材"}</div>
        <div className="truncate text-[11px] leading-4 opacity-50" style={{ color: theme.node.text }}>{asset.category} · {typeLabel}</div>
    </article>;
}

function LibraryAssetsTab({ theme, onAssetDragStart, onAssetDragEnd }: { theme: CanvasTheme; onAssetDragStart: (payload: InsertAssetPayload) => void; onAssetDragEnd: () => void }) {
    const [keyword, setKeyword] = useState("");
    const [type, setType] = useState("");
    const [category, setCategory] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const query = useQuery({
        queryKey: ["canvas-side-library-assets", keyword, type, category, selectedTags, page],
        queryFn: () => fetchAssetLibrary({ keyword, type, category, tag: selectedTags, page, pageSize: ASSET_PAGE_SIZE }),
        retry: false,
    });
    const items = query.data?.items || [];
    const categories = query.data?.categories || [];
    const tags = query.data?.tags || [];

    useEffect(() => setPage(1), [keyword, type, category, selectedTags]);

    return (
        <>
            <div className="grid grid-cols-2 gap-2 px-3 pb-2">
                <div className="min-w-0">
                    <div className="mb-1 text-xs opacity-50" style={{ color: theme.node.text }}>分类</div>
                    <Select size="small" className="w-full" value={category} onChange={setCategory} options={[{ label: "全部", value: "" }, ...categories.map((item) => ({ label: item, value: item }))]} />
                </div>
                <div className="min-w-0">
                    <div className="mb-1 text-xs opacity-50" style={{ color: theme.node.text }}>标签</div>
                    <Select mode="multiple" size="small" className="w-full" value={selectedTags} placeholder="全部" allowClear maxTagCount={1} onChange={(values) => setSelectedTags(values.includes("") ? [] : values)} options={[{ label: "全部", value: "" }, ...tags.map((tag) => ({ label: tag, value: tag }))]} />
                </div>
            </div>
            <div className="flex items-center gap-2 px-3 pb-2">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-muted-text" />} placeholder="搜索素材" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <Select size="small" variant="borderless" className="w-16" value={type} onChange={setType} options={ASSET_TYPE_OPTIONS} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {query.isLoading ? <div className="flex justify-center pt-16"><Spin size="small" /></div> : items.length ? <div className="grid grid-cols-2 gap-2 px-1 pt-1">{items.map((asset) => <LibraryAssetDragCard key={asset.id} asset={asset} theme={theme} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无素材" className="pt-16" />}
                {query.data?.total && query.data.total > ASSET_PAGE_SIZE ? <Pagination className="!mt-3 flex justify-center" size="small" current={page} pageSize={ASSET_PAGE_SIZE} total={query.data.total} showSizeChanger={false} onChange={setPage} /> : null}
            </div>
        </>
    );
}

function AssetDragCard({ asset, theme, onAssetDragStart, onAssetDragEnd }: { asset: Asset; theme: CanvasTheme; onAssetDragStart: (payload: InsertAssetPayload) => void; onAssetDragEnd: () => void }) {
    return <DraggableAssetCard theme={theme} title={asset.title} payload={assetPayload(asset)} kind={asset.kind} imageUrl={asset.kind === "text" ? asset.coverUrl : asset.kind === "image" ? asset.coverUrl || asset.data.dataUrl : asset.kind === "video" ? asset.coverUrl || asset.data.url : ""} text={asset.kind === "text" ? asset.data.content : ""} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} />;
}

function LibraryAssetDragCard({ asset, theme, onAssetDragStart, onAssetDragEnd }: { asset: AssetLibraryItem; theme: CanvasTheme; onAssetDragStart: (payload: InsertAssetPayload) => void; onAssetDragEnd: () => void }) {
    return <DraggableAssetCard theme={theme} title={asset.title} payload={libraryPayload(asset)} kind={asset.type} imageUrl={asset.coverUrl || asset.url} text={asset.content || asset.description} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} />;
}

function DraggableAssetCard({ theme, title, payload, kind, imageUrl, text, onAssetDragStart, onAssetDragEnd }: { theme: CanvasTheme; title: string; payload: InsertAssetPayload; kind: "text" | "image" | "video" | "audio"; imageUrl: string; text: string; onAssetDragStart: (payload: InsertAssetPayload) => void; onAssetDragEnd: () => void }) {
    return (
        <div
            draggable
            title={title}
            onDragStart={(event) => {
                event.dataTransfer.setData(CANVAS_ASSET_DRAG_TYPE, "asset");
                event.dataTransfer.effectAllowed = "copy";
                onAssetDragStart(payload);
            }}
            onDragEnd={onAssetDragEnd}
            className="group relative aspect-square cursor-grab overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing"
            style={{ borderColor: theme.node.stroke, background: theme.node.preview }}
        >
            {kind === "text" ? imageUrl ? <div className="flex size-full flex-col"><img decoding="async" loading="lazy" src={imagePreviewUrl(imageUrl)} alt={title} className="h-1/2 w-full object-contain" /><div className="h-1/2 overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{text}</div></div> : <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{text}</div> : kind === "audio" ? <span className="grid size-full place-items-center"><Music2 className="size-8 opacity-45" /></span> : imageUrl ? kind === "video" ? <video src={imageUrl + "#t=0.1"} muted playsInline preload="metadata" className="size-full object-contain" /> : <img decoding="async" loading="lazy" src={imagePreviewUrl(imageUrl)} alt={title} className="size-full object-contain" /> : <span className="grid size-full place-items-center"><FileText className="size-8 opacity-45" /></span>}
        </div>
    );
}

function assetPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id, source: "asset" };
    if (asset.kind === "image") return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType, source: "asset" };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType, source: "asset" };
    return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id, bytes: asset.data.bytes, mimeType: asset.data.mimeType, durationMs: asset.data.durationMs, source: "asset" };
}

function libraryPayload(asset: AssetLibraryItem): InsertAssetPayload {
    if (asset.type === "text") return { kind: "text", content: asset.content, title: asset.title, assetId: asset.id, source: "library" };
    if (asset.type === "image") return { kind: "image", dataUrl: asset.url, title: asset.title, assetId: asset.id, source: "library" };
    if (asset.type === "video") return { kind: "video", url: asset.url, title: asset.title, assetId: asset.id, source: "library" };
    return { kind: "audio", url: asset.url, title: asset.title, assetId: asset.id, source: "library" };
}

const CanvasPromptsTab = memo(function CanvasPromptsTab({ theme, onInsert }: { theme: CanvasTheme; onInsert: (payload: InsertAssetPayload) => void }) {
    const copyText = useCopyText();
    const [keyword, setKeyword] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({ system: true });
    const [detail, setDetail] = useState<Prompt | null>(null);
    const categoryQuery = useQuery({
        queryKey: ["canvas-side-prompt-categories"],
        queryFn: () => fetchPrompts({ page: 1, pageSize: 1 }),
        retry: false,
    });
    const categories = useMemo(() => ["system", ...(categoryQuery.data?.categories.filter((category) => category !== "system") || [])], [categoryQuery.data?.categories]);

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2.5 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-muted-text" />} placeholder="搜索提示词" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {categoryQuery.isLoading ? <div className="flex justify-center pt-16"><Spin size="small" /></div> : (
                    <div className="space-y-2">
                        {categories.map((category) => {
                            const opened = Boolean(expanded[category]) || Boolean(keyword.trim());
                            return <PromptGroup key={category} category={category} keyword={keyword} open={opened} theme={theme} onToggle={() => setExpanded((current) => ({ ...current, [category]: !current[category] }))} onView={setDetail} onInsert={onInsert} />;
                        })}
                    </div>
                )}
            </div>
            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => copyText(prompt, "已复制提示词")} />
        </div>
    );
});

async function fetchPromptCategory(category: string) {
    const first = await fetchPrompts({ category, page: 1, pageSize: 500 });
    if (first.total <= first.items.length) return first.items;

    const pages = await Promise.all(
        Array.from(
            { length: Math.ceil(first.total / 500) - 1 },
            (_, index) => fetchPrompts({ category, page: index + 2, pageSize: 500 }),
        ),
    );

    return [...first.items, ...pages.flatMap((page) => page.items)];
}

function PromptGroup({ category, keyword, open, theme, onToggle, onView, onInsert }: { category: string; keyword: string; open: boolean; theme: CanvasTheme; onToggle: () => void; onView: (prompt: Prompt) => void; onInsert: (payload: InsertAssetPayload) => void }) {
    const label = category === "system" ? "系统提示词" : category;
    const query = useQuery({
        queryKey: ["canvas-side-prompt-category", category],
        queryFn: () => fetchPromptCategory(category),
        enabled: open,
        staleTime: PROMPT_CACHE_TIME,
        gcTime: PROMPT_CACHE_TIME,
        retry: false,
    });
    const items = useMemo(() => {
        const queryText = keyword.trim().toLowerCase();
        const cachedItems = query.data || [];
        return queryText ? cachedItems.filter((item) => [item.title, item.prompt].join(" ").toLowerCase().includes(queryText)) : cachedItems;
    }, [keyword, query.data]);
    return (
        <div>
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                <BookOpen className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {query.isSuccess && (category === "system" || open) ? <span className="opacity-50">{items.length}</span> : null}
            </button>
            {open ? (
                <div className="space-y-1.5 px-1 pb-2 pt-1">
                    {query.isLoading ? <div className="flex justify-center py-6"><Spin size="small" /></div> : query.isError ? (
                        <button type="button" onClick={() => void query.refetch()} className="block w-full py-4 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">
                            加载失败，点击重试
                        </button>
                    ) : items.length ? (
                        items.map((item) => <PromptRow key={item.id} item={item} theme={theme} onView={() => onView(item)} onInsert={() => onInsert({ kind: "text", content: item.prompt, title: item.title })} />)
                    ) : (
                        <div className="py-4 text-center text-xs opacity-40">{category === "system" ? "暂无提示词" : "该分类暂无提示词"}</div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function PromptRow({ item, theme, onView, onInsert }: { item: Prompt; theme: CanvasTheme; onView: () => void; onInsert: () => void }) {
    return (
        <div className="group relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 dark:hover:bg-white/5">
            {item.coverUrl ? <img decoding="async" src={imagePreviewUrl(item.coverUrl)} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" /> : <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}><FileText className="size-4 opacity-50" /></span>}
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium leading-snug">{item.title}</span>
                <span className="mt-0.5 block truncate text-xs leading-snug opacity-50">{item.prompt}</span>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button type="button" onClick={onView} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label="查看详情"><Eye className="size-3.5" /></button>
                <button type="button" onClick={onInsert} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" style={{ color: theme.toolbar.activeText }} aria-label="插入画布"><Plus className="size-3.5" /></button>
            </div>
        </div>
    );
}
