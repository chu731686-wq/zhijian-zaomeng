"use client";

import { useRef, useState } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import { App, Popover } from "antd";
import { nanoid } from "nanoid";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import type { CanvasPendingMaterial } from "../types";
import type { GenerationReference } from "../utils/canvas-generation-references";
import { MaterialThumbnail } from "./canvas-generation-prompt-input";

export function CanvasNodeReferenceBar({ references, onAdd, onRemove }: { references: GenerationReference[]; onAdd: (materials: CanvasPendingMaterial[]) => void; onRemove: (reference: GenerationReference) => void }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const { message } = App.useApp();
    const upload = async (files: File[]) => {
        if (!files.length) return;
        setUploading(true);
        const joinedAt = Date.now();
        try {
            const results = await Promise.all(files.map(async (file, index): Promise<CanvasPendingMaterial | null> => {
                const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
                if (!kind) { message.warning(`不支持的文件：${file.name}`); return null; }
                try {
                    const uploaded = kind === "image" ? await uploadImage(file) : await uploadMediaFile(file, kind);
                    return { id: `material-${nanoid()}`, kind, createdAt: joinedAt + index / 1000, title: file.name, ...uploaded };
                } catch (error) {
                    message.error(`${file.name}：${error instanceof Error ? error.message : "上传失败"}`);
                    return null;
                }
            }));
            const materials = results.filter((material): material is CanvasPendingMaterial => material !== null);
            if (materials.length) onAdd(materials);
        } finally { setUploading(false); }
    };
    return <div className="mb-2">
        <div className="mb-1.5 text-[11px] font-medium" style={{ color: "var(--muted)" }}>待引用素材</div>
        <input ref={inputRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void upload(files); }} />
        <div className="thin-scrollbar flex min-h-16 gap-2 overflow-x-auto pb-1">
            {references.map((reference) => <div key={reference.id} className="w-16 shrink-0">
                <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferencePreview reference={reference} />} destroyOnHidden>
                    <div className="relative grid h-12 place-items-center rounded-lg border" style={{ background: "var(--raised)", borderColor: "var(--line)" }}>
                        <div className="size-full overflow-hidden rounded-lg"><MaterialThumbnail reference={reference} className="size-full rounded-lg object-contain" /></div>
                        <button type="button" className="absolute -right-1 -top-1 grid size-9 place-items-center rounded-full" style={{ color: "var(--text)" }} aria-label={`移除${reference.label}`} title={reference.connectionId ? "移除素材并断开连线" : "移除素材"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(reference); }}><span className="grid size-5 place-items-center rounded-full border" style={{ background: "var(--raised)", borderColor: "var(--line)" }}><X className="size-3" /></span></button>
                    </div>
                </Popover>
                <div className="mt-1 truncate text-center text-[11px]" style={{ color: "var(--muted)" }}>{reference.label}</div>
            </div>)}
            <button type="button" disabled={uploading} className="grid size-12 shrink-0 place-items-center rounded-lg border transition hover:opacity-70 focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50" style={{ background: "var(--raised)", borderColor: "var(--line)", color: "var(--muted)" }} aria-label="上传待引用素材" title="上传图片、视频或音频（可多选）" onClick={() => inputRef.current?.click()}>{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}</button>
        </div>
    </div>;
}

function ReferencePreview({ reference }: { reference: GenerationReference }) {
    if (reference.kind === "image") return <img src={reference.previewUrl} alt={reference.label} className="block max-h-52 max-w-72 rounded-lg object-contain" />;
    if (reference.kind === "video") return <video src={reference.previewUrl} className="block max-h-52 max-w-72 rounded-lg" controls playsInline preload="metadata" />;
    return <audio src={reference.previewUrl} className="w-72" controls />;
}
