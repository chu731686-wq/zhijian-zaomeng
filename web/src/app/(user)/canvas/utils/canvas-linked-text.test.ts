import assert from "node:assert/strict";
import test from "node:test";
import { syncLinkedTextPrompt } from "./canvas-linked-text.ts";

test("empty prompt receives the source text", () => {
    const result = syncLinkedTextPrompt("", [], [{ nodeId: "a", text: "A段" }]);

    assert.deepEqual(result, {
        prompt: "A段",
        applied: [{ nodeId: "a", text: "A段" }],
    });
});

test("source text is appended after existing prompt text", () => {
    const result = syncLinkedTextPrompt("我的字", [], [{ nodeId: "a", text: "A段" }]);

    assert.deepEqual(result, {
        prompt: "我的字\nA段",
        applied: [{ nodeId: "a", text: "A段" }],
    });
});

test("multiple source texts are appended in source order", () => {
    const result = syncLinkedTextPrompt("我的字", [], [
        { nodeId: "a", text: "A段" },
        { nodeId: "b", text: "B段" },
    ]);

    assert.deepEqual(result, {
        prompt: "我的字\nA段\nB段",
        applied: [
            { nodeId: "a", text: "A段" },
            { nodeId: "b", text: "B段" },
        ],
    });
});

test("changed source text replaces the previously applied text", () => {
    const result = syncLinkedTextPrompt(
        "我的字\nA段",
        [{ nodeId: "a", text: "A段" }],
        [{ nodeId: "a", text: "A段新" }],
    );

    assert.deepEqual(result, {
        prompt: "我的字\nA段新",
        applied: [{ nodeId: "a", text: "A段新" }],
    });
});

test("disconnecting a source removes its previously applied text", () => {
    const result = syncLinkedTextPrompt("我的字\nA段", [{ nodeId: "a", text: "A段" }], []);

    assert.deepEqual(result, { prompt: "我的字", applied: [] });
});

test("applying the same source result twice leaves it unchanged", () => {
    const first = syncLinkedTextPrompt("我的字", [], [{ nodeId: "a", text: "A段" }]);
    const second = syncLinkedTextPrompt(first.prompt, first.applied, [{ nodeId: "a", text: "A段" }]);

    assert.deepEqual(second, first);
});

test("user edits are left alone while the linked source text is unchanged", () => {
    const result = syncLinkedTextPrompt(
        "我的字\n白衣人在雨中",
        [{ nodeId: "a", text: "黑衣人在雨中" }],
        [{ nodeId: "a", text: "黑衣人在雨中" }],
    );

    assert.deepEqual(result, {
        prompt: "我的字\n白衣人在雨中",
        applied: [{ nodeId: "a", text: "黑衣人在雨中" }],
    });
});

test("typing right after the synced text does not duplicate it", () => {
    const result = syncLinkedTextPrompt("黑衣人在雨中水墨风格 ", [{ nodeId: "a", text: "黑衣人在雨中" }], [{ nodeId: "a", text: "黑衣人在雨中" }]);

    assert.deepEqual(result, { prompt: "黑衣人在雨中水墨风格 ", applied: [{ nodeId: "a", text: "黑衣人在雨中" }] });
});

test("old synced text is removed wherever it is when the source changes", () => {
    const result = syncLinkedTextPrompt("黑衣人在雨中水墨风格 ", [{ nodeId: "a", text: "黑衣人在雨中" }], [{ nodeId: "a", text: "黑衣人回头" }]);

    assert.deepEqual(result, { prompt: "水墨风格\n黑衣人回头", applied: [{ nodeId: "a", text: "黑衣人回头" }] });
});

test("source text is trimmed before syncing", () => {
    const result = syncLinkedTextPrompt("我的字", [], [{ nodeId: "a", text: "  A段  " }]);

    assert.deepEqual(result, { prompt: "我的字\nA段", applied: [{ nodeId: "a", text: "A段" }] });
});

test("blank source text is removed and leaves the prompt unchanged", () => {
    const result = syncLinkedTextPrompt("原有内容  ", [], [{ nodeId: "a", text: " \n  " }]);

    assert.deepEqual(result, { prompt: "原有内容  ", applied: [] });
});

test("empty applied and source lists preserve the prompt exactly", () => {
    const result = syncLinkedTextPrompt("abc  ", [], []);

    assert.deepEqual(result, { prompt: "abc  ", applied: [] });
});

test("edited synced text is taken over: a source change does not overwrite or append", () => {
    const result = syncLinkedTextPrompt("我的字\n黑衣人站", [{ nodeId: "a", text: "黑衣人在雨中" }], [{ nodeId: "a", text: "黑衣人回头" }]);

    assert.deepEqual(result, { prompt: "我的字\n黑衣人站", applied: [{ nodeId: "a", text: "黑衣人回头" }] });
});

test("taken-over source stays taken over on later changes", () => {
    const result = syncLinkedTextPrompt("我的字\n黑衣人站", [{ nodeId: "a", text: "黑衣人回头" }], [{ nodeId: "a", text: "黑衣人转身" }]);

    assert.deepEqual(result, { prompt: "我的字\n黑衣人站", applied: [{ nodeId: "a", text: "黑衣人转身" }] });
});

test("disconnecting a taken-over source leaves the prompt alone", () => {
    const result = syncLinkedTextPrompt("我的字\n黑衣人站", [{ nodeId: "a", text: "黑衣人回头" }], []);

    assert.deepEqual(result, { prompt: "我的字\n黑衣人站", applied: [] });
});

test("only the untouched source keeps syncing when another was taken over", () => {
    const result = syncLinkedTextPrompt(
        "我的字\nA段改\nB段",
        [{ nodeId: "a", text: "A段" }, { nodeId: "b", text: "B段" }],
        [{ nodeId: "a", text: "A段新" }, { nodeId: "b", text: "B段新" }],
    );

    assert.deepEqual(result, {
        prompt: "我的字\nA段改\nB段新",
        applied: [{ nodeId: "a", text: "A段新" }, { nodeId: "b", text: "B段新" }],
    });
});
