export type FitNodeBounds = { x: number; y: number; width: number; height: number; hidden?: boolean };
export type FitContainerSize = { width: number; height: number };
export type FitInsets = { left: number; right: number; top: number; bottom: number };
export type FitViewport = { x: number; y: number; k: number };

export function computeFitViewport(
    nodes: FitNodeBounds[],
    container: FitContainerSize,
    insets: FitInsets,
): FitViewport {
    const left = Math.max(0, Math.min(container.width, insets.left));
    const right = Math.max(left, Math.min(container.width, container.width - insets.right));
    const top = Math.max(0, Math.min(container.height, insets.top));
    const bottom = Math.max(top, Math.min(container.height, container.height - insets.bottom));
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const visibleNodes = nodes.filter((node) => !node.hidden);

    if (!visibleNodes.length) return { x: centerX, y: centerY, k: 1 };

    const bounds = visibleNodes.reduce((acc, node) => ({
        left: Math.min(acc.left, node.x),
        top: Math.min(acc.top, node.y),
        right: Math.max(acc.right, node.x + node.width),
        bottom: Math.max(acc.bottom, node.y + node.height),
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    const width = Math.max(1, bounds.right - bounds.left);
    const height = Math.max(1, bounds.bottom - bounds.top);
    const availableWidth = Math.max(1, right - left - 120);
    const availableHeight = Math.max(1, bottom - top - 120);
    const k = Math.max(0.1, Math.min(1, availableWidth / width, availableHeight / height));

    return {
        x: centerX - (bounds.left + bounds.right) / 2 * k,
        y: centerY - (bounds.top + bounds.bottom) / 2 * k,
        k,
    };
}
