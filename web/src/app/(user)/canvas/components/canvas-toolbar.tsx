import Link from "next/link";
import { Dropdown } from "antd";
import { Globe2, Image as ImageIcon, Layers3, Music2, Plus, Settings2, Type, Upload, Video } from "lucide-react";
import styles from "./canvas-studio.module.css";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";

export function CanvasToolbar({
    selectedCount,
    canvasTool,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddPanorama,
    onAddDirector,
    onAddConfig,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onCanvasToolChange,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onAddGroup,
}: {
    selectedCount: number;
    canvasTool: "select" | "pan";
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddPanorama: () => void;
    onAddDirector: () => void;
    onAddConfig: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onCanvasToolChange: (tool: "select" | "pan") => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onAddGroup: () => void;
}) {
    const types = [
        { key: "text", label: "文本", icon: <Type size={16} />, onClick: onAddText },
        { key: "image", label: "图片", icon: <ImageIcon size={16} />, onClick: onAddImage },
        { key: "video", label: "视频", icon: <Video size={16} />, onClick: onAddVideo },
        { key: "audio", label: "音频", icon: <Music2 size={16} />, onClick: onAddAudio },
        { key: "panorama", label: "全景图", icon: <Globe2 size={16} />, onClick: onAddPanorama },
        { key: "director", label: "导演台", icon: <Layers3 size={16} />, onClick: onAddDirector },
        { key: "config", label: "生成配置", icon: <Settings2 size={16} />, onClick: onAddConfig },
        { key: "upload", label: "上传素材", icon: <Upload size={16} />, onClick: onUpload },
    ];
    return (
        <nav className={styles.toolRail} aria-label="画布工具" data-canvas-no-zoom>
            <Dropdown trigger={["click"]} placement="bottomLeft" menu={{ items: types }}>
                <button type="button" className={styles.railButton} aria-label="添加节点"><span className={styles.addIcon}><Plus /></span>添加</button>
            </Dropdown>
            {types.slice(0, 4).map(({ key, label, icon, onClick }) => <button key={key} type="button" className={styles.railButton} onClick={onClick}>{icon}{label}</button>)}
            <button type="button" className={styles.railButton} onClick={onAddGroup}><Layers3 />分组</button>
            <div className="my-1 h-px bg-line" />
            <Link className={styles.railButton} href="/templates"><Layers3 />模板</Link>
        </nav>
    );
}
