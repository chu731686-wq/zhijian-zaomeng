import assert from "node:assert/strict";
import test from "node:test";
import { checkManjuVideoPrompt } from "./canvas-skill-prompt-guard.ts";

const full = [
    "【精准主体】林砚，青衫，祭刀台，夜。",
    "【整片质感】3D动态漫基底原文……石台粗糙质感。",
    "【核心剧情】",
    "镜头1：",
    "拍摄：近景。",
    "台词：林砚说：“我娘就在丹房？”",
    "【补充光影】月光自左上方。",
    "【防崩约束】人物面部和身体比例稳定不变形。",
].join("\n");

test("five sections in order pass", () => {
    assert.deepEqual(checkManjuVideoPrompt(full), { ok: true });
});

test("short custom format is rejected with all missing sections", () => {
    const result = checkManjuVideoPrompt("【参考】图片一=林砚\n【画面】林砚抬头\n【运镜】推近\n【台词】林砚：我娘？\n【后期】字幕");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.missing, ["【精准主体】", "【整片质感】", "【核心剧情】", "【补充光影】", "【防崩约束】"]);
    assert.match(result.message, /read_skill_file/);
    assert.match(result.message, /输出格式-常规模型\.md/);
});

test("missing one section is reported", () => {
    const result = checkManjuVideoPrompt(full.replace(/【补充光影】[^\n]*\n/, ""));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.missing, ["【补充光影】"]);
});

test("empty section counts as missing", () => {
    const result = checkManjuVideoPrompt(full.replace("【补充光影】月光自左上方。", "【补充光影】  "));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.missing, ["【补充光影】"]);
});

test("sections out of order are rejected", () => {
    const swapped = full.replace("【精准主体】林砚，青衫，祭刀台，夜。\n", "").replace("【防崩约束】", "【精准主体】林砚。\n【防崩约束】");
    const result = checkManjuVideoPrompt(swapped);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /顺序/);
});
