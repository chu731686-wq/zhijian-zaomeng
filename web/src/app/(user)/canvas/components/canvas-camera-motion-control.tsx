"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, CornerDownRight, CornerUpLeft, CornerUpRight, LockKeyhole, Move3d, MoveHorizontal, Rotate3d, RotateCw, X } from "lucide-react";
import styles from "./canvas-camera-motion.module.css";
import { Button, Switch } from "antd";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CAMERA_MOTION_PRESETS, type CameraMotionPreset } from "../utils/canvas-camera-motion";
import type { CameraMotionOptions } from "../types";

type Props = { value?: CameraMotionOptions; onChange: (value: CameraMotionOptions) => void; buttonClassName?: string };
const DEFAULT_MOTION: CameraMotionOptions = { enabled: false, preset: "", intensity: "medium" };
const INTENSITIES: { id: CameraMotionOptions["intensity"]; label: string }[] = [
    { id: "light", label: "轻" }, { id: "medium", label: "中" }, { id: "strong", label: "强" },
];

export function CanvasCameraMotionControl({ value, onChange, buttonClassName }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const motion = value || DEFAULT_MOTION;
    const selected = CAMERA_MOTION_PRESETS.find((item) => item.id === motion.preset);
    const update = (patch: Partial<CameraMotionOptions>) => onChange({ ...motion, ...patch });

    useEffect(() => {
        if (!open || !buttonRef.current) return;
        const trigger = buttonRef.current;
        let frame = 0;
        const sync = () => setRect(trigger.getBoundingClientRect());
        const follow = () => { sync(); frame = window.requestAnimationFrame(follow); };
        const outside = (event: PointerEvent) => {
            if (!(event.target instanceof Node) || trigger.contains(event.target) || panelRef.current?.contains(event.target)) return;
            setOpen(false);
        };
        follow();
        window.addEventListener("resize", sync);
        window.addEventListener("scroll", sync, true);
        window.addEventListener("pointerdown", outside, true);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("resize", sync);
            window.removeEventListener("scroll", sync, true);
            window.removeEventListener("pointerdown", outside, true);
        };
    }, [open]);

    const panelStyle = rect ? {
        position: "fixed" as const, zIndex: 1200, width: 560,
        maxHeight: "min(78vh, 620px)", overflowY: "auto" as const,
        left: Math.max(280, Math.min(window.innerWidth - 280, rect.left + rect.width / 2)),
        bottom: window.innerHeight - rect.top + 8,
        transform: "translateX(-50%)", background: theme.toolbar.panel,
        border: "1px solid " + theme.toolbar.border, borderRadius: 18,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)", color: theme.node.text,
    } : undefined;

    return <>
        <span ref={buttonRef} className="inline-flex min-w-0" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Button
                icon={<Move3d className="size-4" />}
                className={buttonClassName || "!h-10 !min-w-[92px] !justify-start !rounded-full !px-3"}
                style={{ background: motion.enabled ? theme.toolbar.activeBg : theme.node.fill, borderColor: motion.enabled ? theme.node.activeStroke : theme.node.stroke, color: motion.enabled ? theme.toolbar.activeText : theme.node.text }}
                aria-expanded={open} onClick={() => setOpen((current) => !current)}
            >{selected ? `${selected.name} · ${INTENSITIES.find((item) => item.id === motion.intensity)?.label || "中"}` : "运镜"}</Button>
        </span>
        {open && rect && panelStyle ? createPortal(
            <div ref={panelRef} style={panelStyle} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: theme.toolbar.border }}>
                    <h2 className="text-base font-semibold">运镜</h2>
                    <div className="flex items-center gap-2">
                        <span className="text-sm" style={{ color: theme.node.muted }}>启用</span>
                        <Switch size="small" checked={motion.enabled} aria-label="启用运镜" onChange={(enabled) => update({ enabled })} />
                        <button type="button" className="grid size-8 place-items-center rounded-lg transition hover:opacity-70" style={{ color: theme.node.muted }} aria-label="关闭" onClick={() => setOpen(false)}><X className="size-5" /></button>
                    </div>
                </div>
                <div className="px-5 py-3">
                    {(["基础", "电影感"] as const).map((group) => <section key={group} className={group === "电影感" ? "mt-3" : ""}>
                        <h3 className="mb-2 text-xs font-medium" style={{ color: theme.node.muted }}>{group}</h3>
                        <div className="grid grid-cols-5 gap-2">
                            {CAMERA_MOTION_PRESETS.filter((preset) => preset.group === group).map((preset) => <MotionCard key={preset.id} preset={preset} selected={motion.preset === preset.id} onClick={() => update(motion.preset === preset.id ? { preset: "", enabled: false } : { preset: preset.id, enabled: true })} />)}
                        </div>
                    </section>)}
                    <div className="mt-3 flex items-center justify-between border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                        <span className="text-sm" style={{ color: theme.node.muted }}>幅度</span>
                        <div className="flex rounded-lg p-0.5" style={{ background: theme.node.fill }}>
                            {INTENSITIES.map((item) => <button key={item.id} type="button" className="rounded-md px-4 py-1 text-sm transition-colors" style={{ background: motion.intensity === item.id ? theme.toolbar.activeBg : "transparent", color: motion.intensity === item.id ? theme.toolbar.activeText : theme.node.text }} onClick={() => update({ intensity: item.id })}>{item.label}</button>)}
                        </div>
                    </div>
                </div>
            </div>, document.body,
        ) : null}
    </>;
}

const MOTION_ICONS = {
    static: LockKeyhole,
    push: ArrowUpRight,
    pull: ArrowDownLeft,
    "pan-left": CornerUpLeft,
    "pan-right": CornerUpRight,
    "tilt-up": CornerUpRight,
    "tilt-down": CornerDownRight,
    "truck-left": ArrowLeft,
    "truck-right": ArrowRight,
    "crane-up": ArrowUp,
    "crane-down": ArrowDown,
    tracking: ArrowRight,
    orbit: Rotate3d,
    handheld: MoveHorizontal,
    "dolly-zoom": MoveHorizontal,
    "whip-pan": ArrowLeft,
    "aerial-dive": ArrowDownRight,
    pov: ArrowUp,
    roll: RotateCw,
};

function MotionCard({ preset, selected, onClick }: { preset: CameraMotionPreset; selected: boolean; onClick: () => void }) {
    const DirectionIcon = MOTION_ICONS[preset.animation as keyof typeof MOTION_ICONS];
    return <button type="button" title={preset.description} aria-pressed={selected} onClick={onClick} className={styles.card} data-motion={preset.animation}>
        <div className={styles.frame} aria-hidden="true">
            <div className={styles.stage}>
                <div className={styles.grid}>
                    <svg className={styles.rays} viewBox="0 0 72 44" width="72" height="44" fill="none">
                        <path d="M36 16  -36 44 M36 16 0 44 M36 16 36 44 M36 16 72 44 M36 16 108 44" />
                    </svg>
                    <div className={styles.rows}>
                        <span className={styles.row} /><span className={styles.row} /><span className={styles.row} />
                    </div>
                </div>
                <span className={styles.light} />
                <div className={styles.subject}>
                    <svg viewBox="0 0 16 22" width="16" height="22" fill="currentColor">
                        <circle cx="8" cy="5" r="3.5" />
                        <path d="M4 11h8l3 9H1Z" />
                    </svg>
                </div>
            </div>
            <DirectionIcon className={styles.direction} size={10} strokeWidth={1.75} />
        </div>
        <span className={styles.name}>{preset.name}</span>
    </button>;
}
