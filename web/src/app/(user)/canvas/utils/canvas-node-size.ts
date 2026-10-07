"use client";

export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    return { width: w * scale, height: h * scale };
}

const IMAGE_NODE_HORIZONTAL_CHROME = 30;
const IMAGE_NODE_VERTICAL_CHROME = 122;

export function imageNodeCardSize(width: number, height: number, nodeWidth = 248) {
    const naturalWidth = Math.max(1, width);
    const naturalHeight = Math.max(1, height);
    const previewWidth = Math.max(1, nodeWidth - IMAGE_NODE_HORIZONTAL_CHROME);
    return {
        width: nodeWidth,
        height: IMAGE_NODE_VERTICAL_CHROME + previewWidth * naturalHeight / naturalWidth,
    };
}

export function canvasFitNodeSize(width: number, height: number, naturalWidth?: number, naturalHeight?: number, hasImageContent = false, freeResize = false) {
    if (hasImageContent && !freeResize && naturalWidth && naturalHeight) {
        return imageNodeCardSize(naturalWidth, naturalHeight, width);
    }
    return { width, height };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
}
