import { Bot, Compass, Focus, Hand, Library, Minus, MousePointer2, Plus, Redo2, Undo2 } from "lucide-react";
import styles from "./canvas-studio.module.css";

type CanvasZoomControlsProps = {
    scale: number; onScaleChange: (scale: number) => void; onReset: () => void;
    isMiniMapOpen: boolean; onToggleMiniMap: () => void;
    canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
    assistantOpen: boolean; onToggleAssistant: () => void;
    assetLibraryOpen: boolean; onToggleAssetLibrary: () => void;
    canvasTool: "select" | "pan"; onCanvasToolChange: (tool: "select" | "pan") => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap, canUndo, canRedo, onUndo, onRedo, assistantOpen, onToggleAssistant, assetLibraryOpen, onToggleAssetLibrary, canvasTool, onCanvasToolChange }: CanvasZoomControlsProps) {
    const buttonClass = "studio-icon-button !size-9 !min-h-9 !rounded-lg disabled:!text-subtle";
    return (
        <div className={`${styles.dock} box-border w-max min-w-0`} aria-label="画布控制" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="studio-icon-button !h-9 !w-auto !gap-2 !px-3" style={assetLibraryOpen ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined} aria-pressed={assetLibraryOpen} onClick={onToggleAssetLibrary}><Library size={16} /><span className="text-xs">素材库</span></button>
            <span className={styles.divider} />
            <button type="button" className={buttonClass} disabled={!canUndo} aria-label="撤销" title="撤销" onClick={onUndo}><Undo2 size={16} /></button>
            <button type="button" className={buttonClass} disabled={!canRedo} aria-label="重做" title="重做" onClick={onRedo}><Redo2 size={16} /></button>
            <span className={styles.divider} />
            <button type="button" className={buttonClass} title={canvasTool === "pan" ? "切换为选择工具" : "切换为平移工具"} aria-label={canvasTool === "pan" ? "切换为选择工具" : "切换为平移工具"} onClick={() => onCanvasToolChange(canvasTool === "select" ? "pan" : "select")}>{canvasTool === "pan" ? <Hand size={16} /> : <MousePointer2 size={16} />}</button>
            <button type="button" className={buttonClass} aria-label="缩小" title="缩小" onClick={() => onScaleChange(scale / 1.2)}><Minus size={16} /></button>
            <span className="w-12 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
            <button type="button" className={buttonClass} aria-label="放大" title="放大" onClick={() => onScaleChange(scale * 1.2)}><Plus size={16} /></button>
            <button type="button" className="studio-icon-button !h-9 !w-auto !gap-1 !px-2" aria-label="适应画面" title="适应画面" onClick={onReset}><Focus size={16} /><span className={`${styles.fitLabel} text-xs`}>适应画面</span></button>
            <button type="button" className={buttonClass} aria-label="小地图" title="小地图" aria-pressed={isMiniMapOpen} onClick={onToggleMiniMap}><Compass size={16} /></button>
            <span className={styles.divider} />
            <button type="button" className="studio-icon-button !h-9 !w-auto !gap-2 !px-3" style={assistantOpen ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined} aria-pressed={assistantOpen} onClick={onToggleAssistant}><Bot size={16} /><span className="text-xs">助手</span></button>
        </div>
    );
}
