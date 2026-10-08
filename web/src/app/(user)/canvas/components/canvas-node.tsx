"use client";
import { useCanvasModelConfig } from "@/app/(user)/canvas/hooks/use-canvas-model-config";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { AlertCircle, Check, Circle, Clapperboard, ChevronRight, Image as ImageIcon, LoaderCircle, Maximize2, Music2, Pause, Play, RefreshCw, Star, Type, Settings2, Video, Users, MapPin, Package, Layers3 } from "lucide-react";

import { imagePreviewUrl } from "@/services/image-storage";
import styles from "./canvas-studio.module.css";
import { useConfigStore, resolveModelForCapability, selectableModelsByCapability } from "@/stores/use-config-store";
import { canvasGroupColors, canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, type CanvasNodeData, type Position } from "../types";
import { isCanvasImageNodeType } from "../utils/canvas-panorama";
import { GROUP_TITLE_HEIGHT } from "../utils/canvas-group";
import { useLocalImagePreview } from "../utils/use-local-image-preview";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "var(--accent)";
const CanvasPanoramaViewer = dynamic(() => import("./canvas-panorama-viewer"), { ssr: false, loading: () => null });

type CanvasNodeProps = {
    readOnly?: boolean;
    presenceColor?: string;
    onReadOnlySelect?: (node: CanvasNodeData) => void;
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    referenceSelectionState?: "target" | "disabled" | "available";
    showPanel: boolean;
    showImageInfo: boolean;
    modelUnavailable?: boolean;
    mentionReferences?: CanvasResourceReference[];
    now?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
    batchPreviews?: { src: string; title: string }[];
    groupChildCount?: number;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    minimapOpen?: boolean;
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onGroupPointerDown?: (event: React.PointerEvent<HTMLDivElement>, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onSelectReference?: (nodeId: string) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    previewWidth?: number;
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isSelected: boolean;
    canSelectText?: boolean;
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchPreviews?: { src: string; title: string }[];
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    now?: number;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    onMoveStart?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export const CanvasNode = React.memo(function CanvasNode({
    readOnly = false,
    presenceColor,
    onReadOnlySelect,
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    referenceSelectionState,
    showPanel,
    showImageInfo,
    modelUnavailable,
    mentionReferences = [],
    now,
    renderPanel,
    renderNodeContent,
    batchCount = 0,
    batchPreviews,
    groupChildCount = 0,
    isGroupDropTarget = false,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchMotion,
    onMouseDown,
    onGroupPointerDown,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResize,
    onContentChange,
    onTitleChange,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onViewImage,
    onSelectReference,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useCanvasModelConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const capability = data.type === CanvasNodeType.Video ? "video" : data.type === CanvasNodeType.Audio ? "audio" : data.type === CanvasNodeType.Text ? "text" : "image";
    const hasCapabilityModel = selectableModelsByCapability(effectiveConfig, capability).length > 0;
    const unavailable = modelUnavailable ?? (!data.metadata?.content && (!data.metadata?.status || data.metadata.status === "idle") && ![CanvasNodeType.Group, CanvasNodeType.Director, CanvasNodeType.Config].includes(data.type) && (!hasCapabilityModel || !isAiConfigReady(effectiveConfig, resolveModelForCapability(effectiveConfig, data.metadata?.model, capability))));
    const status = data.metadata?.status || "idle";
    const TypeIcon = data.type === CanvasNodeType.Text ? Type : data.type === CanvasNodeType.Video ? Video : data.type === CanvasNodeType.Audio ? Music2 : data.type === CanvasNodeType.Director ? Clapperboard : data.type === CanvasNodeType.Config ? Settings2 : ImageIcon;
    const typeLabel = { text: "剧本 / 文本", image: "图片 / 分镜", panorama: "全景图", video: "视频", audio: "音频", director: "导演台", config: "生成配置", group: "分组" }[data.type];
    const [hovered, setHovered] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const isGroup = data.type === CanvasNodeType.Group;
    const groupCategory = data.metadata?.category && data.metadata.category in canvasGroupColors ? data.metadata.category as keyof typeof canvasGroupColors : "其他";
    const groupColor = canvasGroupColors[groupCategory];
    const GroupIcon = groupCategory === "人物" ? Users : groupCategory === "场景" ? MapPin : groupCategory === "道具" ? Package : groupCategory === "分集" ? Layers3 : Circle;
    const hasImageContent = isCanvasImageNodeType(data.type) && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isBatchRoot = isCanvasImageNodeType(data.type) && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    const isBatchChild = isCanvasImageNodeType(data.type) && Boolean(data.metadata?.batchRootId);
    const isActive = isSelected;
    const imageBorderColor = isActive ? selectionBlue : isRelated && !isBatchChild ? theme.node.muted : "transparent";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const nodeElementRef = useRef<HTMLDivElement>(null);
    const [panelPosition, setPanelPosition] = useState({ left: 0, top: 0 });
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
        extraWidth: 0,
        extraHeight: 0,
    });

    useEffect(() => {
        if (!readOnly) return;
        setIsEditingTitle(false);
        setIsEditingContent(false);
        resizeRef.current.isResizing = false;
    }, [readOnly]);

    useEffect(() => {
        setTitleDraft(data.title || "");
    }, [data.title]);

    useLayoutEffect(() => {
        if (!showPanel || isGroup) return;
        let frame = 0;
        let active = true;
        const updatePosition = () => {
            const rect = nodeElementRef.current?.getBoundingClientRect();
            if (rect) {
                const left = rect.left + rect.width / 2;
                const top = rect.bottom + 12;
                setPanelPosition((current) => current.left === left && current.top === top ? current : { left, top });
            }
            if (active) frame = window.requestAnimationFrame(updatePosition);
        };
        updatePosition();
        return () => {
            active = false;
            window.cancelAnimationFrame(frame);
        };
    }, [data.id, isGroup, showPanel]);

    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || "未命名节点";
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (!readOnly && title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, titleDraft, readOnly]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = 220;
            const minHeight = 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                const extraWidth = resizeRef.current.extraWidth;
                const extraHeight = resizeRef.current.extraHeight;
                const minMediaWidth = Math.max(1, minWidth - extraWidth, (minHeight - extraHeight) * ratio);
                const minMediaHeight = Math.max(1, minHeight - extraHeight, (minWidth - extraWidth) / ratio);
                if (Math.abs(dx) >= Math.abs(dy)) {
                    const mediaWidth = Math.max(minMediaWidth, rawWidth - extraWidth);
                    width = mediaWidth + extraWidth;
                    height = mediaWidth / ratio + extraHeight;
                } else {
                    const mediaHeight = Math.max(minMediaHeight, rawHeight - extraHeight);
                    height = mediaHeight + extraHeight;
                    width = mediaHeight * ratio + extraWidth;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
    }, [handleResizeMove]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        const nodeElement = nodeElementRef.current;
        const previewElement = nodeElement?.querySelector<HTMLElement>(`.${styles.preview}`);
        const nodeRect = nodeElement?.getBoundingClientRect();
        const previewRect = previewElement?.getBoundingClientRect();
        const extraWidth = nodeRect && previewRect ? Math.max(0, (nodeRect.width - previewRect.width) / scale) : 0;
        const extraHeight = nodeRect && previewRect ? Math.max(0, (nodeRect.height - previewRect.height) / scale) : 0;
        const imageElement = previewElement?.querySelector("img");
        const videoElement = previewElement?.querySelector("video");
        const displayWidth = previewRect ? previewRect.width / scale : Math.max(1, data.width - extraWidth);
        const displayHeight = previewRect ? previewRect.height / scale : Math.max(1, data.height - extraHeight);
        const naturalWidth = data.type === CanvasNodeType.Video
            ? videoElement?.videoWidth || displayWidth
            : Number(data.metadata?.naturalWidth) || imageElement?.naturalWidth || displayWidth;
        const naturalHeight = data.type === CanvasNodeType.Video
            ? videoElement?.videoHeight || displayHeight
            : Number(data.metadata?.naturalHeight) || imageElement?.naturalHeight || displayHeight;
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (isCanvasImageNodeType(data.type) || data.type === CanvasNodeType.Video) && data.metadata?.freeResize !== true,
            ratio: naturalWidth / Math.max(1, naturalHeight),
            extraWidth,
            extraHeight,
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
        };
    }, [handleResizeMove, handleResizeUp]);

    return (
        <div
            ref={nodeElementRef}
            onClick={readOnly ? () => onReadOnlySelect ? onReadOnlySelect(data) : (hasImageContent || hasVideoContent) && onViewImage?.(data) : undefined}
            data-node-id={data.id}
            data-group-category={isGroup ? groupCategory : undefined}
            className={`node-element absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-auto" : isSelected ? "z-50" : "z-10"} ${referenceSelectionState === "available" ? "cursor-pointer" : referenceSelectionState ? "cursor-not-allowed" : ""}`}
            style={{
                // Groups must not create a stacking context: the frame stays
                // below nodes while its title can sit above them.
                transform: isGroup ? undefined : `translate(${data.position.x}px, ${data.position.y}px)`,
                left: isGroup ? data.position.x : undefined,
                top: isGroup ? data.position.y : undefined,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                outline: presenceColor ? `1px solid ${presenceColor}` : undefined,
                outlineOffset: presenceColor ? 3 : undefined,
                contain: isGroup ? undefined : "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => {
                if (!referenceSelectionState) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.button === 0 && referenceSelectionState === "available") onSelectReference?.(data.id);
            }}
            onContextMenu={(event) => {
                if (readOnly || referenceSelectionState) event.preventDefault();
                else onContextMenu(event, data.id);
            }}
        >

                {isGroup ? <div
                    data-group-title="true"
                    className="absolute inset-x-0 top-0 z-[60] flex shrink-0 cursor-grab items-center gap-1.5 overflow-hidden rounded-t-[9px] px-2.5 text-[12px] font-semibold active:cursor-grabbing"
                    style={{ height: GROUP_TITLE_HEIGHT, background: `${groupColor}38`, color: theme.node.text }}
                    onPointerDown={(event) => {
                        event.stopPropagation();
                        if (readOnly || event.button !== 0 || referenceSelectionState) return;
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        (onGroupPointerDown || onMouseDown)(event, data.id);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                >
                    <GroupIcon className="size-3.5 shrink-0" style={{ color: groupColor }} />
                    {isEditingTitle ? <input
                        ref={titleInputRef}
                        value={titleDraft}
                        maxLength={64}
                        className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={finishTitleEditing}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter") finishTitleEditing();
                            if (event.key === "Escape") { setTitleDraft(data.title || ""); setIsEditingTitle(false); }
                        }}
                    /> : <span className="min-w-0 flex-1 truncate" onDoubleClick={(event) => { event.stopPropagation(); if (!readOnly) setIsEditingTitle(true); }}>{data.title || "未命名分组"}</span>}
                    <span className="shrink-0 opacity-75"> · {groupChildCount}</span>
                </div> : null}

            <div
                className={`relative h-full w-full overflow-visible ${styles.nodeCard}`}
                data-selected={isActive}
                data-status={status}
                data-unavailable={unavailable}
                style={{
                    background: isGroup ? `${groupColor}14` : theme.node.panel,
                    borderColor: isGroup ? groupColor : isActive || isGroupDropTarget ? selectionBlue : isConnectionTarget ? theme.types[data.type] : hovered ? theme.node.hoverStroke : theme.node.stroke,
                    borderWidth: isGroup ? (isActive || isGroupDropTarget ? 2.5 : 1.5) : undefined,
                    borderRadius: isGroup ? 10 : undefined,
                    padding: isGroup ? 0 : undefined,
                    gap: isGroup ? 0 : undefined,
                    boxShadow: !isGroup && (isActive || isGroupDropTarget) ? `0 0 0 1px ${selectionBlue}` : undefined,
                }}
                onMouseDown={(event) => { if (!readOnly) onMouseDown(event, data.id); }}
                onDoubleClick={(event) => {
                    if (referenceSelectionState) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if ((isCanvasImageNodeType(data.type) && hasImageContent) || (data.type === CanvasNodeType.Video && hasVideoContent)) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (data.type === CanvasNodeType.Video && event.target instanceof HTMLVideoElement) event.target.pause();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    if (!readOnly) setIsEditingContent(true);
                }}
            >
                {!isGroup ? <div className={styles.nodeHead}>
                    <span className={styles.nodeType}><TypeIcon style={{ color: theme.types[data.type] }} /><span className={styles.nodeTypeName} title={typeLabel}>{typeLabel}</span></span>
                    <span className={styles.nodeStatus} style={{ color: unavailable ? theme.node.muted : theme.status[status] }}>
                        {status === "loading" ? <LoaderCircle className="studio-spin" /> : status === "error" ? <AlertCircle /> : status === "success" ? <Check /> : <Circle className="!size-1.5" fill="currentColor" />}
                        {unavailable ? "未接入" : status === "loading" ? `生成中 ${Math.round(data.metadata?.progress || 0)}%` : status === "error" ? "出错" : status === "success" ? "已完成" : "等待中"}
                    </span>
                </div> : null}
            {!referenceSelectionState && !isGroup ? <div
                className={styles.nodeTitle}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {isEditingTitle ? (
                    <input
                        ref={titleInputRef}
                        value={titleDraft}
                        maxLength={64}
                        className="h-[22px] w-full border-0 bg-transparent p-0 text-left text-[15px] font-semibold outline-none"
                        style={{ borderColor: theme.node.muted, color: theme.node.text }}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={finishTitleEditing}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") finishTitleEditing();
                            if (event.key === "Escape") {
                                setTitleDraft(data.title || "");
                                setIsEditingTitle(false);
                            }
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="block w-full truncate text-left text-[15px] font-semibold"
                        style={{ color: unavailable ? theme.node.muted : theme.node.text }}
                        title="双击修改节点名称"
                        onDoubleClick={(event) => {
                            event.stopPropagation();
                            if (!readOnly) setIsEditingTitle(true);
                        }}
                    >
                        {data.title || "未命名节点"}
                    </button>
                )}
            </div> : null}

                <div
                    className={`relative flex items-center justify-center ${isGroup ? "h-full" : styles.preview} ${isBatchRoot ? "!overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: isGroup ? "transparent" : theme.node.preview,
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? "canvas-batch-child-out 260ms cubic-bezier(.4,0,.2,1) both" : "canvas-batch-child-in 340ms cubic-bezier(.2,.85,.18,1) both") : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    {!isGroup ? (
                        <NodeContent
                            node={data}
                            previewWidth={data.width * scale}
                            theme={theme}
                            isSelected={isSelected}
                            canSelectText={!referenceSelectionState}
                            now={now}
                            isEditingContent={isEditingContent}
                            textareaRef={textareaRef}
                            isBatchRoot={isBatchRoot}
                            batchCount={batchCount}
                            batchPreviews={batchPreviews}
                            batchExpanded={batchExpanded}
                            batchOpening={batchOpening}
                            batchRecovering={batchRecovering}
                            renderNodeContent={renderNodeContent}
                            mentionReferences={mentionReferences}
                            onContentChange={onContentChange}
                            onStopEditing={() => setIsEditingContent(false)}
                            onRetry={readOnly ? undefined : onRetry}
                            onViewImage={onViewImage}
                            onToggleBatch={readOnly ? undefined : () => onToggleBatch?.(data.id)}
                            onSetBatchPrimary={readOnly ? undefined : () => onSetBatchPrimary?.(data)}
                            onMoveStart={readOnly ? undefined : (event) => onMouseDown(event, data.id)}
                        />
                    ) : null}
                </div>

                {!isGroup ? <div className={styles.parameters} title={data.metadata?.model || undefined}>
                    {[data.metadata?.size || (data.type === CanvasNodeType.Video ? "16:9" : data.type === CanvasNodeType.Text ? `${(data.metadata?.content || "").length} 字` : hasImageContent ? `${data.metadata?.naturalWidth || data.width} × ${data.metadata?.naturalHeight || data.height}` : "待设置"), data.metadata?.vquality || data.metadata?.quality, data.metadata?.seconds ? `${data.metadata.seconds}s` : data.metadata?.audioFormat, data.metadata?.model].filter(Boolean).join(" · ")}
                </div> : null}
                {status === "loading" ? <><div className={styles.progress}><span style={{ width: `${Math.max(4, Math.min(100, data.metadata?.progress || 0))}%` }} /></div><p className="text-[11px] text-running">正在生成{batchCount > 1 ? `镜头 · 共 ${batchCount} 个` : typeLabel}…</p></> : null}
                {!readOnly && unavailable ? <div className="flex items-center justify-between gap-2 text-xs text-muted-text"><span>模型尚未接入</span><button type="button" className="min-h-9 rounded-lg bg-raised px-2 text-text hover:bg-hover" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openConfigDialog(false); }}>去设置</button></div> : null}

                {referenceSelectionState && (referenceSelectionState !== "available" || hovered) ? (
                    <div className="pointer-events-none absolute inset-0 z-[60] grid place-items-center rounded-[inherit]" style={{ background: `color-mix(in srgb, ${theme.canvas.background} ${referenceSelectionState === "target" ? 78 : referenceSelectionState === "disabled" ? 60 : 34}%, transparent)`, boxShadow: referenceSelectionState === "available" ? `inset 0 0 0 2px ${selectionBlue}` : undefined }}>
                        {referenceSelectionState !== "disabled" ? <span className="rounded-lg px-3 py-2 text-sm font-medium shadow-sm" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{referenceSelectionState === "target" ? "正在添加参考" : "选择"}</span> : null}
                    </div>
                ) : null}

                {!readOnly && !referenceSelectionState ? <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} /> : null}
                {!readOnly && !referenceSelectionState ? <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} /> : null}
                {!readOnly && !referenceSelectionState ? <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} /> : null}
                {!readOnly && !referenceSelectionState ? <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} /> : null}
            </div>

            {!readOnly && !referenceSelectionState && !isGroup ? (
                <>
                    <ConnectionHandleDot color={theme.types[data.type]} side="left" visible={true} onMouseDown={(event) => onConnectStart(event, data.id, "target")} />
                    <ConnectionHandleDot color={theme.types[data.type]} side="right" visible={data.type !== CanvasNodeType.Config} onMouseDown={(event) => onConnectStart(event, data.id, "source")} />
                </>
            ) : null}

            {!referenceSelectionState && showPanel && !isGroup && renderPanel && typeof document !== "undefined" ? createPortal(
                <div className={"fixed z-[140] max-h-[calc(100vh-88px)] max-w-[calc(100vw-24px)] -translate-x-1/2 overflow-y-auto " + (isCanvasImageNodeType(data.type) || data.type === CanvasNodeType.Video || data.type === CanvasNodeType.Audio ? "w-[622px]" : "w-[500px]")}
                    style={{ left: readOnly ? Math.max(Math.min(311, window.innerWidth / 2), Math.min(panelPosition.left, window.innerWidth - Math.min(311, window.innerWidth / 2))) : panelPosition.left, top: readOnly ? Math.max(64, Math.min(panelPosition.top, window.innerHeight - 360)) : panelPosition.top }}>
                    {renderPanel(data)}
                </div>,
                document.body,
            ) : null}
        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    if (props.node.type === CanvasNodeType.Group) return null;
    if ((props.node.type === CanvasNodeType.Config || props.node.type === CanvasNodeType.Director) && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return props.node.type === CanvasNodeType.Panorama ? <PanoramaNodeContent {...props} /> : <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading" && (props.node.type !== CanvasNodeType.Text || !props.node.metadata.content)) return <LoadingContent node={props.node} theme={props.theme} now={props.now} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type];
    return Renderer ? <Renderer {...props} /> : <UnknownNodeContent theme={props.theme} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: React.memo(TextContent, (previous, next) =>
        previous.node.id === next.node.id
        && previous.node.metadata?.content === next.node.metadata?.content
        && previous.node.metadata?.fontSize === next.node.metadata?.fontSize
        && previous.theme === next.theme
        && previous.isSelected === next.isSelected
        && previous.canSelectText === next.canSelectText
        && previous.isEditingContent === next.isEditingContent
        && previous.textareaRef === next.textareaRef
        && previous.mentionReferences === next.mentionReferences
        && previous.onContentChange === next.onContentChange
        && previous.onStopEditing === next.onStopEditing
    ),
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Panorama]: PanoramaNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Director]: EmptyImageContent,
} satisfies Partial<Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>>;

function LoadingContent({ node, theme, now }: Pick<NodeContentRendererProps, "node" | "theme" | "now">) {
    const startTimeRef = useRef(Date.now());
    const [localNow, setLocalNow] = useState(Date.now());
    useEffect(() => {
        if (now !== undefined) return;
        const timer = window.setInterval(() => setLocalNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [now]);
    const currentNow = now ?? localNow;
    const startedAt = typeof node.metadata?.startedAt === "number" ? node.metadata.startedAt : startTimeRef.current;
    const elapsedMs = Math.max(0, currentNow - startedAt);
    const progress = Math.max(0, Math.min(100, Math.round(node.metadata?.progress || 0)));

    if (node.type === CanvasNodeType.Video) {
        return (
            <div className="flex h-full w-full flex-col justify-between overflow-hidden p-4" style={{ color: theme.node.text }}>
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
                    <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.status.loading }} />
                    <div className="text-sm font-semibold" style={{ color: theme.status.loading }}>
                        正在创作 {progress}%
                    </div>
                    <span className="rounded-full px-2 py-1 text-xs" style={{ background: theme.toolbar.panel, color: theme.node.text }}>
                        {formatDuration(elapsedMs)}
                    </span>
                </div>
                <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]" style={{ color: theme.node.muted }}>
                        <span>当前创作进度</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="h-0.5 overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: theme.status.loading }} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.status.loading }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.status.loading }} />
            <span className="text-[10px] tracking-[0.2em]">{progress > 0 ? `生成中 ${progress}%` : "生成中"}</span>
            <span className="rounded-full border px-2 py-1 text-xs tracking-normal" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                {formatDuration(elapsedMs)}
            </span>
            {progress > 0 ? (
                <div className="h-0.5 w-28 overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: theme.status.loading }} />
                </div>
            ) : null}
        </div>
    );
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    const errorDetails = node.metadata?.errorDetails || "生成失败，请重试";
    const errorPreview = errorDetails.length > 60 ? `${errorDetails.slice(0, 59)}…` : errorDetails;
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="flex w-full items-start gap-1 text-xs leading-5 text-error"><AlertCircle className="mt-0.5 size-4 shrink-0" /><div className="min-w-0 text-left"><div>请求失败</div><div className="break-words" title={errorDetails}>{errorPreview}</div></div></div>
            {onRetry ? <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition hover:scale-[1.02]"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                重试
            </button> : null}
        </div>
    );
}

function UnknownNodeContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    return (
        <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: theme.node.placeholder }}>
            未知节点
        </div>
    );
}

function TextContent({ node, theme, isSelected, canSelectText = true, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing }: NodeContentRendererProps) {
    const content = node.metadata?.content || "";
    const [draft, setDraft] = useState(content);
    const pendingContentRef = useRef<string | null>(null);
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const selectionCleanupRef = useRef<(() => void) | null>(null);

    useLayoutEffect(() => () => selectionCleanupRef.current?.(), [content, isSelected, canSelectText, isEditingContent]);

    const startTextSelection = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!isSelected) return;
        event.stopPropagation();
        if (!canSelectText || event.button !== 0 || !event.isPrimary || event.pointerType !== "mouse") return;

        selectionCleanupRef.current?.();
        const body = event.currentTarget;
        const doc = body.ownerDocument;
        const selection = doc.getSelection();
        const caretAt = (x: number, y: number) => {
            // 正文内边距也能作为拖选起点；按画布缩放把坐标收敛到文字区域。
            const rect = body.getBoundingClientRect();
            const style = getComputedStyle(body);
            const scaleX = rect.width / body.offsetWidth;
            const scaleY = rect.height / body.offsetHeight;
            x = Math.max(rect.left + parseFloat(style.paddingLeft) * scaleX, Math.min(x, rect.right - parseFloat(style.paddingRight) * scaleX - 1));
            y = Math.max(rect.top + parseFloat(style.paddingTop) * scaleY, Math.min(y, rect.bottom - parseFloat(style.paddingBottom) * scaleY - 1));
            const caret = doc.caretPositionFromPoint?.(x, y);
            const range = caret ? null : doc.caretRangeFromPoint?.(x, y);
            const node = caret?.offsetNode ?? range?.startContainer;
            const offset = caret?.offset ?? range?.startOffset;
            return node && offset !== undefined && body.contains(node) ? { node, offset } : null;
        };
        const anchor = caretAt(event.clientX, event.clientY);
        if (!selection || !anchor) return;

        // 原生拖选偶发始终折叠；固定正文内起点并接管拖选，不依赖浏览器默认动作。
        event.preventDefault();
        body.focus({ preventScroll: true });
        selection.setBaseAndExtent(anchor.node, anchor.offset, anchor.node, anchor.offset);
        const pointerId = event.pointerId;
        const updateSelection = (move: PointerEvent) => {
            if (!body.isConnected || !body.contains(anchor.node)) return;
            const focus = caretAt(move.clientX, move.clientY);
            if (focus) selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        };
        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            if (!(moveEvent.buttons & 1)) {
                cleanup();
                return;
            }
            updateSelection(moveEvent);
        };
        const finish = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== pointerId) return;
            if (upEvent.type === "pointerup") updateSelection(upEvent);
            cleanup();
        };
        const cleanup = () => {
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", finish, true);
            window.removeEventListener("pointercancel", finish, true);
            window.removeEventListener("blur", cleanup);
            selectionCleanupRef.current = null;
        };
        selectionCleanupRef.current = cleanup;
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
        window.addEventListener("blur", cleanup);
    };

    const flushContent = useCallback(() => {
        if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
        const pending = pendingContentRef.current;
        if (pending === null) return;
        pendingContentRef.current = null;
        onContentChange(node.id, pending);
    }, [node.id, onContentChange]);

    useLayoutEffect(() => {
        // 外部生成/撤销仍可更新正文，尚未提交的本地输入不被旧值覆盖。
        if (pendingContentRef.current === null) setDraft(content);
    }, [content]);

    useLayoutEffect(() => {
        if (!isEditingContent) flushContent();
    }, [flushContent, isEditingContent]);

    useLayoutEffect(() => () => flushContent(), [flushContent]);

    const stopEditing = () => {
        flushContent();
        onStopEditing();
    };
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden">
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className="thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent p-4 m-0 font-sans outline-none select-text appearance-none"
                    style={textStyle}
                    value={draft}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => {
                        setDraft(value);
                        pendingContentRef.current = value;
                        if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
                        // 连续按键只更新此编辑器，停顿后再触发整张画布及项目 store 更新。
                        commitTimerRef.current = setTimeout(flushContent, 120);
                    }}
                    onBlur={stopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") stopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : (
                <div
                    data-text-node-body="true"
                    tabIndex={isSelected ? -1 : undefined}
                    className={`thin-scrollbar block w-full line-clamp-4 whitespace-pre-wrap break-words bg-transparent p-3 font-sans outline-none ${isSelected ? "cursor-text select-text" : ""}`}
                    style={{ ...textStyle, userSelect: isSelected ? "text" : undefined, WebkitUserSelect: isSelected ? "text" : undefined }}
                    onMouseDownCapture={(event) => {
                        if (!isSelected) return;
                        event.stopPropagation();
                        if (event.button === 0 && selectionCleanupRef.current) event.preventDefault();
                    }}
                    onPointerDownCapture={startTextSelection}
                    onMouseDown={(event) => {
                        if (isSelected) event.stopPropagation();
                    }}
                    onPointerDown={(event) => {
                        if (isSelected) event.stopPropagation();
                    }}
                    onWheelCapture={(event) => event.stopPropagation()}
                >
                    {node.metadata?.content || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
                </div>
            )}
        </div>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent node={props.node} theme={props.theme} now={props.now} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch}>
                {content}
            </BatchFrame>
        );
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            previewWidth={props.previewWidth}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
            media={props.isBatchRoot && props.batchPreviews?.length ? <div className="grid h-full grid-cols-2 content-center gap-1 p-1">{props.batchPreviews.slice(0, 4).map((frame, index) => <div key={index} className="relative aspect-video overflow-hidden rounded bg-bg"><img src={imagePreviewUrl(frame.src)} alt={frame.title} draggable={false} loading="lazy" decoding="async" className="pointer-events-none h-full w-full object-contain" /><span className="absolute bottom-0 left-0 rounded-tr bg-surface px-1 text-[11px] text-t-image">{String(index + 1).padStart(2, "0")}</span></div>)}</div> : undefined}
        />
    );
}

function PanoramaNodeContent(props: NodeContentRendererProps) {
    const src = props.node.metadata?.content;
    const source = imagePreviewUrl(src || "", props.previewWidth, props.node.metadata?.storageKey);
    const displaySource = useLocalImagePreview(source);
    if (!src) return <ImageNodeContent {...props} />;
    const proxyGeneratedPanorama = Boolean(props.node.metadata?.imageTaskId || props.node.metadata?.imageTaskResultId) && !props.node.metadata?.storageKey;

    return (
        <ImageContent
            node={props.node}
            previewWidth={props.previewWidth}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
            media={<CanvasPanoramaViewer src={displaySource} alt={props.node.title} proxyGeneratedPanorama={proxyGeneratedPanorama} expandOnDoubleClick={!props.isBatchRoot} onMoveStart={props.onMoveStart} onOpen={props.onViewImage ? () => props.onViewImage?.(props.node) : undefined} />}
        />
    );
}

function EmptyImageContent({ node, theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: NodeContentRendererProps) {
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-6 opacity-30" />
            </div>
            <span className="text-[10px] tracking-[0.18em] opacity-50">{node.type === CanvasNodeType.Panorama ? "空全景图节点" : "空图片节点"}</span>
        </div>
    );
    if (isBatchRoot)
        return (
            <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

function VideoNodeContent({ node, theme, isSelected, onViewImage }: NodeContentRendererProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [mediaDurationMs, setMediaDurationMs] = useState(0);
    const [videoTime, setVideoTime] = useState(0);
    const videoDuration = mediaDurationMs / 1000;
    const togglePlayback = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play();
        else video.pause();
    };
    useEffect(() => {
        if (!isSelected) videoRef.current?.pause();
        if (isSelected) videoRef.current?.focus({ preventScroll: true });
        else if (document.activeElement === videoRef.current) videoRef.current?.blur();
    }, [isSelected, node.metadata?.content]);
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">空视频节点</span>
            </div>
        );
    const controlStyle = { background: theme.toolbar.panel, color: theme.toolbar.item };
    const controlClassName = "absolute bottom-2 z-20 flex size-9 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100";
    const keepVideoFocus = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (isSelected) videoRef.current?.focus({ preventScroll: true });
    };
    return (
        <div className="relative aspect-video max-h-full w-full overflow-hidden rounded-lg" style={{ background: theme.node.preview }}>
            <video ref={videoRef} preload="metadata" src={node.metadata.content} tabIndex={-1} playsInline className="h-full w-full object-contain outline-none" onLoadStart={() => { setVideoTime(0); setMediaDurationMs(0); }} onLoadedMetadata={(event) => setMediaDurationMs(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 : 0)} onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onKeyDown={(event) => { if (isSelected && event.code === "Space") { event.preventDefault(); event.stopPropagation(); togglePlayback(); } }} />
            {mediaDurationMs > 0 ? <span className="pointer-events-none absolute left-2 top-2 z-20 flex h-7 items-center justify-center rounded-md px-2 text-[11px] font-medium opacity-70" style={controlStyle}>{new Date(mediaDurationMs).toISOString().slice(mediaDurationMs >= 3_600_000 ? 11 : 14, 19)}</span> : null}
            <button type="button" title={isPlaying ? "暂停" : "播放"} aria-label={isPlaying ? "暂停" : "播放"} className={`${controlClassName} left-2`} style={controlStyle} onClick={(event) => { event.stopPropagation(); togglePlayback(); }} onMouseDown={keepVideoFocus} onDoubleClick={(event) => event.stopPropagation()}>
                {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <button type="button" title="放大预览" aria-label="放大预览" className={`${controlClassName} right-2`} style={controlStyle} onClick={(event) => { event.stopPropagation(); videoRef.current?.pause(); onViewImage?.(node); }} onMouseDown={keepVideoFocus} onDoubleClick={(event) => event.stopPropagation()}>
                <Maximize2 className="size-3.5" />
            </button>
            <div className="absolute bottom-2 left-11 right-11 z-20 flex h-7 items-center" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                <input
                    type="range"
                    min={0}
                    max={videoDuration}
                    step="0.01"
                    value={Math.min(videoTime, videoDuration)}
                    disabled={videoDuration <= 0}
                    aria-label="视频进度"
                    onChange={(event) => {
                        if (!videoRef.current) return;
                        const time = event.currentTarget.valueAsNumber;
                        videoRef.current.currentTime = time;
                        setVideoTime(time);
                    }}
                    onPointerUp={() => videoRef.current?.focus({ preventScroll: true })}
                    className="pointer-events-auto block h-1 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    style={{ background: `linear-gradient(to right, ${theme.types.video} ${videoDuration > 0 ? Math.min(videoTime / videoDuration, 1) * 100 : 0}%, ${theme.node.stroke} 0)` }}
                />
            </div>
        </div>
    );
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7 opacity-35" />
                <span className="text-sm">空音频节点</span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{node.title || "音频"}</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ImageContent({
    node,
    previewWidth,
    isBatchRoot,
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    onSetBatchPrimary,
    media,
}: {
    node: CanvasNodeData;
    previewWidth?: number;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    media?: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const source = imagePreviewUrl(node.metadata!.content!, previewWidth, node.metadata?.storageKey);
    const displaySource = useLocalImagePreview(source);
    const isBatchChild = Boolean(node.metadata?.batchRootId);

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
            <div className="h-full w-full overflow-hidden rounded-lg">
                {media ?? (
                    <img
                        src={displaySource}
                        loading="lazy"
                        decoding="async"
                        alt={node.title}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        className="pointer-events-none block h-full w-full select-none object-contain"
                    />
                )}
            </div>
            {isBatchRoot && onToggleBatch ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    aria-label={batchExpanded ? "图片组已展开" : "图片组已收起"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none text-t-image">{batchCount}</span>
                    <ChevronRight className={`size-3.5 opacity-55 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
            {isBatchChild && onSetBatchPrimary ? (
                <button
                    type="button"
                    className="absolute right-3 top-3 z-30 flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium opacity-0 transition group-hover/batch:opacity-100 hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetBatchPrimary?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Star className="size-3.5 text-t-image" />
                    设为主图
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-surface px-2 py-1 text-[11px] font-medium leading-none text-text">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({ batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch, children }: { batchCount: number; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; onToggleBatch?: () => void; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: theme.node.panel,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ color, side, visible, onMouseDown }: { color: string; side: "left" | "right"; visible: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={`absolute top-1/2 z-30 flex size-6 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${side === "left" ? "-left-3" : "-right-3"
                } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onMouseDown}
        >
            <div className={`size-2.5 rounded-full ${styles.port}`} style={{ background: color }} />
        </div>
    );
}
