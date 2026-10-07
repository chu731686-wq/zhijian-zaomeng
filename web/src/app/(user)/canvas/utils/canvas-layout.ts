import type { CanvasNodeData, Position } from "../types";

export const CANVAS_NODE_GAP = 24;

type NodeSize = { width: number; height: number };

function squareSpiralOffsets(stepX: number, stepY: number, maxRings: number) {
    const offsets: Position[] = [{ x: 0, y: 0 }];
    for (let ring = 1; ring <= maxRings; ring += 1) {
        offsets.push({ x: ring * stepX, y: 0 });
        for (let y = 1; y <= ring; y += 1) offsets.push({ x: ring * stepX, y: y * stepY });
        for (let x = ring - 1; x >= -ring; x -= 1) offsets.push({ x: x * stepX, y: ring * stepY });
        for (let y = ring - 1; y >= -ring; y -= 1) offsets.push({ x: -ring * stepX, y: y * stepY });
        for (let x = -ring + 1; x <= ring; x += 1) offsets.push({ x: x * stepX, y: -ring * stepY });
        for (let y = -ring + 1; y < 0; y += 1) offsets.push({ x: ring * stepX, y: y * stepY });
    }
    return offsets;
}

export function findAvailableNodeCenter(
    desiredCenter: Position,
    size: NodeSize,
    existingNodes: CanvasNodeData[],
    excludedNodeIds: Set<string> = new Set(),
): Position {
    const collides = (center: Position) => {
        const left = center.x - size.width / 2;
        const top = center.y - size.height / 2;
        const right = left + size.width;
        const bottom = top + size.height;
        return existingNodes.some((node) => {
            if (excludedNodeIds.has(node.id)) return false;
            return left < node.position.x + node.width + CANVAS_NODE_GAP
                && right + CANVAS_NODE_GAP > node.position.x
                && top < node.position.y + node.height + CANVAS_NODE_GAP
                && bottom + CANVAS_NODE_GAP > node.position.y;
        });
    };

    if (!collides(desiredCenter)) return desiredCenter;
    const stepX = size.width + CANVAS_NODE_GAP * 2;
    const stepY = size.height + CANVAS_NODE_GAP * 2;
    const maxRings = Math.max(32, existingNodes.length * 4 + 8);
    for (const offset of squareSpiralOffsets(stepX, stepY, maxRings)) {
        if (offset.x === 0 && offset.y === 0) continue;
        const candidate = { x: desiredCenter.x + offset.x, y: desiredCenter.y + offset.y };
        if (!collides(candidate)) return candidate;
    }
    return {
        x: desiredCenter.x,
        y: Math.max(desiredCenter.y, ...existingNodes.map((node) => node.position.y + node.height + CANVAS_NODE_GAP + size.height / 2)),
    };
}

export function findAvailableRectPosition(
    desiredPosition: Position,
    size: NodeSize,
    existingNodes: CanvasNodeData[],
    excludedNodeIds: Set<string> = new Set(),
    gap = 40,
): Position {
    const collides = (position: Position) => existingNodes.some((node) => {
        if (excludedNodeIds.has(node.id)) return false;
        return position.x < node.position.x + node.width + gap
            && position.x + size.width + gap > node.position.x
            && position.y < node.position.y + node.height + gap
            && position.y + size.height + gap > node.position.y;
    });
    if (!collides(desiredPosition)) return desiredPosition;

    const stepX = size.width + gap * 2;
    const stepY = size.height + gap * 2;
    const maxRings = Math.max(32, existingNodes.length * 4 + 8);
    for (const offset of squareSpiralOffsets(stepX, stepY, maxRings)) {
        if (offset.x === 0 && offset.y === 0) continue;
        const candidate = { x: desiredPosition.x + offset.x, y: desiredPosition.y + offset.y };
        if (!collides(candidate)) return candidate;
    }
    return {
        x: desiredPosition.x,
        y: Math.max(desiredPosition.y, ...existingNodes.map((node) => node.position.y + node.height + gap + size.height)),
    };
}
