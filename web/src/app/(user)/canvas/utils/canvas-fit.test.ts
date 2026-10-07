import assert from "node:assert/strict";
import test from "node:test";
import { computeFitViewport } from "./canvas-fit.ts";

type NodeBounds = { x: number; y: number; width: number; height: number; hidden?: boolean };
type Insets = { left: number; right: number; top: number; bottom: number };

const noInsets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

function closeTo(actual: number, expected: number, message: string): void {
    assert.ok(Math.abs(actual - expected) <= 1, `${message}: expected ${expected} ±1, got ${actual}`);
}

function screenPoint(viewport: { x: number; y: number; k: number }, x: number, y: number) {
    return { x: viewport.x + x * viewport.k, y: viewport.y + y * viewport.k };
}

test("single node fits at scale 1 and is centered in the container", () => {
    const [node] = [{ x: 0, y: 0, width: 200, height: 100 }];
    const viewport = computeFitViewport([node], { width: 1000, height: 800 }, noInsets);
    const center = screenPoint(viewport, node.x + node.width / 2, node.y + node.height / 2);

    assert.equal(viewport.k, 1);
    closeTo(center.x, 500, "node center x");
    closeTo(center.y, 400, "node center y");
});

test("two distant nodes fit inside the 60px horizontal margins", () => {
    const nodes = [
        { x: 0, y: 0, width: 200, height: 100 },
        { x: 3000, y: 0, width: 200, height: 100 },
    ];
    const viewport = computeFitViewport(nodes, { width: 1000, height: 800 }, noInsets);

    assert.ok(viewport.k < 1);
    for (const node of nodes) {
        const left = screenPoint(viewport, node.x, node.y).x;
        const right = screenPoint(viewport, node.x + node.width, node.y).x;
        assert.ok(left >= 60 - 1, `node left edge should be at least 60px, got ${left}`);
        assert.ok(right <= 940 + 1, `node right edge should be at most 940px, got ${right}`);
    }
});

test("hidden nodes do not affect the fit", () => {
    const nodes = [
        { x: 0, y: 0, width: 200, height: 100 },
        { x: 3000, y: 0, width: 200, height: 100 },
    ];
    const container = { width: 1000, height: 800 };
    const expected = computeFitViewport(nodes, container, noInsets);
    const actual = computeFitViewport([...nodes, { x: 10000, y: 10000, width: 200, height: 100, hidden: true }], container, noInsets);

    assert.deepEqual(actual, expected);
});

test("insets define the center used to place the node bounds", () => {
    const node = { x: 0, y: 0, width: 200, height: 100 };
    const viewport = computeFitViewport([node], { width: 1000, height: 800 }, { ...noInsets, left: 72, bottom: 80 });
    const center = screenPoint(viewport, node.x + node.width / 2, node.y + node.height / 2);

    closeTo(center.x, (72 + 1000) / 2, "inset area center x");
    closeTo(center.y, (800 - 80) / 2, "inset area center y");
});

test("scale does not go below 0.1 for bounds spanning 20000px", () => {
    const viewport = computeFitViewport([{ x: 0, y: 0, width: 20000, height: 100 }], { width: 1000, height: 800 }, noInsets);

    assert.equal(viewport.k, 0.1);
});

test("moving a node farther away reduces the fit scale", () => {
    const container = { width: 1000, height: 800 };
    const nearby = [
        { x: 0, y: 0, width: 200, height: 100 },
        { x: 3000, y: 0, width: 200, height: 100 },
    ];
    const spread = [nearby[0], { ...nearby[1], x: 6000 }];

    assert.ok(computeFitViewport(spread, container, noInsets).k < computeFitViewport(nearby, container, noInsets).k);
});

test("empty node list uses the available area center at scale 1", () => {
    const viewport = computeFitViewport([], { width: 1000, height: 800 }, { ...noInsets, left: 72, bottom: 80 });

    assert.equal(viewport.k, 1);
    closeTo(viewport.x, (72 + 1000) / 2, "empty origin x");
    closeTo(viewport.y, (800 - 80) / 2, "empty origin y");
});
