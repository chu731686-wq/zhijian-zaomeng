import { CanvasNodeType, type CanvasNodeData } from "../types";
import { CANVAS_NODE_GAP, findAvailableRectPosition } from "./canvas-layout";

export const GROUP_PADDING = 24;
export const GROUP_TITLE_HEIGHT = 30;
export const GROUP_TOP_PADDING = GROUP_TITLE_HEIGHT + 12;

export function packGroup(groupId: string, nodes: CanvasNodeData[]) {
    const group = nodes.find((node) => node.id === groupId && node.type === CanvasNodeType.Group);
    const children = nodes
        .filter((node) => node.metadata?.groupId === groupId)
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    if (!group || !children.length) return nodes;

    const rows: CanvasNodeData[][] = [];
    for (let index = 0; index < children.length; index += 4) rows.push(children.slice(index, index + 4));
    const width = Math.max(...rows.map((row) => row.reduce((total, node) => total + node.width, 0) + CANVAS_NODE_GAP * (row.length - 1))) + GROUP_PADDING * 2;
    const contentHeight = rows.reduce((total, row) => total + Math.max(...row.map((node) => node.height)), 0) + CANVAS_NODE_GAP * (rows.length - 1);
    const height = GROUP_TOP_PADDING + contentHeight + GROUP_PADDING;
    const memberIds = new Set(children.map((node) => node.id));
    const excludedIds = new Set([...memberIds, groupId]);
    const desiredPosition = findAvailableRectPosition(
        group.position,
        { width, height },
        nodes,
        excludedIds,
        40,
    );

    let y = desiredPosition.y + GROUP_TOP_PADDING;
    const positions = new Map<string, { x: number; y: number }>();
    for (const row of rows) {
        let x = desiredPosition.x + GROUP_PADDING;
        const rowHeight = Math.max(...row.map((node) => node.height));
        for (const node of row) {
            positions.set(node.id, { x, y });
            x += node.width + CANVAS_NODE_GAP;
        }
        y += rowHeight + CANVAS_NODE_GAP;
    }

    return nodes.map((node) => {
        if (node.id === groupId) return { ...node, position: desiredPosition, width, height };
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
    });
}

// Keep the frame behind its members, with a separate strip reserved for the title.
export function expandGroupsToFitNodes(nodes: CanvasNodeData[], groupIds?: Set<string>) {
    return nodes.map((group) => {
        if (group.type !== CanvasNodeType.Group || (groupIds && !groupIds.has(group.id))) return group;
        const children = nodes.filter((node) => node.metadata?.groupId === group.id);
        if (!children.length) return group;
        const bounds = getNodeBounds(children);
        const x = Math.min(group.position.x, bounds.left - GROUP_PADDING);
        const y = Math.min(group.position.y, bounds.top - GROUP_TOP_PADDING);
        const width = Math.max(group.position.x + group.width, bounds.right + GROUP_PADDING) - x;
        const height = Math.max(group.position.y + group.height, bounds.bottom + GROUP_PADDING) - y;
        return x === group.position.x && y === group.position.y && width === group.width && height === group.height
            ? group
            : { ...group, position: { x, y }, width, height };
    });
}

export function getNodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (bounds, node) => ({
            left: Math.min(bounds.left, node.position.x),
            top: Math.min(bounds.top, node.position.y),
            right: Math.max(bounds.right, node.position.x + node.width),
            bottom: Math.max(bounds.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

export function findGroupDropTarget(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    if (nodes.some((node) => movedIds.has(node.id) && node.type === CanvasNodeType.Group)) return null;

    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    return [...nodes].reverse().find((group) => {
        if (group.type !== CanvasNodeType.Group || movedIds.has(group.id)) return false;
        return movingNodes.some((node) => {
            const centerX = node.position.x + node.width / 2;
            const centerY = node.position.y + node.height / 2;
            return centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height;
        });
    }) || null;
}

export function snapNodesIntoGroup(movedIds: Set<string>, nodes: CanvasNodeData[], group: CanvasNodeData) {
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return nodes;

    const bounds = getNodeBounds(movingNodes);
    const left = group.position.x + GROUP_PADDING;
    const top = group.position.y + GROUP_TOP_PADDING;
    const right = group.position.x + group.width - GROUP_PADDING;
    const bottom = group.position.y + group.height - GROUP_PADDING;
    // Oversized selections stay below the title; expand the frame instead of
    // snapping their top edge back over the title to satisfy the bottom edge.
    const dx = Math.max(left, Math.min(bounds.left, right - (bounds.right - bounds.left))) - bounds.left;
    const dy = Math.max(top, Math.min(bounds.top, bottom - (bounds.bottom - bounds.top))) - bounds.top;

    const snapped = nodes.map((node) => {
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
        return {
            ...node,
            position: { x: node.position.x + dx, y: node.position.y + dy },
            metadata: { ...node.metadata, groupId: group.id },
        };
    });
    return expandGroupsToFitNodes(snapped, new Set([group.id]));
}

export function findContainingGroupId(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const centerX = node.position.x + node.width / 2;
    const centerY = node.position.y + node.height / 2;
    return [...nodes].reverse().find((group) => group.type === CanvasNodeType.Group && centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height)?.id;
}
