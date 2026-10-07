"use client";

import { useEffect, useState } from "react";

type PreviewEntry = { promise: Promise<string>; refs: number; url?: string };
const previews = new Map<string, PreviewEntry>();

async function makePreviewUrl(source: string) {
    const response = await fetch(source);
    if (!response.ok) throw new Error("图片读取失败");
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        if (scale === 1) return source;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return source;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const previewBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, blob.type || "image/png"));
        return previewBlob ? URL.createObjectURL(previewBlob) : source;
    } finally {
        bitmap.close();
    }
}

export function useLocalImagePreview(source: string) {
    const [preview, setPreview] = useState(source);
    useEffect(() => {
        if (!source.startsWith("blob:") && !source.startsWith("data:")) {
            setPreview(source);
            return;
        }
        let active = true;
        let entry = previews.get(source);
        if (!entry) {
            entry = { promise: makePreviewUrl(source).catch(() => source), refs: 0 };
            previews.set(source, entry);
            const createdEntry = entry;
            void entry.promise.then((url) => {
                createdEntry.url = url.startsWith("blob:") && url !== source ? url : undefined;
                if (createdEntry.refs === 0) {
                    if (previews.get(source) === createdEntry) previews.delete(source);
                    if (createdEntry.url) URL.revokeObjectURL(createdEntry.url);
                }
            });
        }
        entry.refs += 1;
        void entry.promise.then((url) => { if (active) setPreview(url); });
        return () => {
            active = false;
            entry!.refs -= 1;
            if (entry!.refs === 0) {
                previews.delete(source);
                if (entry!.url) {
                    URL.revokeObjectURL(entry!.url);
                    entry!.url = undefined;
                }
            }
        };
    }, [source]);
    return preview;
}
