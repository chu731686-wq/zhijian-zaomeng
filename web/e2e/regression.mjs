import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { deflateSync, deflateRawSync } from "node:zlib";
const mockHits = { hello: [], deepseek: [] };
function startMock(name, port) {
    const server = createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
            let model = "";
            let parsed = {};
            try { parsed = JSON.parse(body || "{}"); model = parsed.model || ""; } catch {}
            mockHits[name].push({ path: req.url, model });
            const usage = { prompt_tokens: 48000, completion_tokens: 10, total_tokens: 48010, input_tokens: 48000, output_tokens: 10 };
            if (parsed.stream) {
                res.setHeader("Content-Type", "text/event-stream");
                if (req.url.includes("responses")) {
                    res.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "你好" })}\n\n`);
                    res.write(`data: ${JSON.stringify({ type: "response.completed", response: { id: "r1", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "你好" }] }], usage } })}\n\n`);
                } else {
                    res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "你好" }, finish_reason: null }] })}\n\n`);
                    res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
                    res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [], usage })}\n\n`);
                }
                res.end("data: [DONE]\n\n");
                return;
            }
            res.setHeader("Content-Type", "application/json");
            if (req.url.includes("responses")) res.end(JSON.stringify({ id: "r1", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "你好" }] }], usage }));
            else res.end(JSON.stringify({ id: "c1", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "你好" } }], usage }));
        });
    });
    server.listen(port, "127.0.0.1");
    return server;
}
const mockServers = [startMock("hello", 18081), startMock("deepseek", 18082)];
const testModelConfig = {
    channelMode: "local",
    localChannels: [
        { id: "e2e-model", protocol: "openai", name: "回归测试模型", baseUrl: "http://127.0.0.1:18081/v1", apiKey: "e2e-mock-key", models: ["gpt-image-2", "chatgpt-image-latest-extra-long-preview", ...Array.from({ length: 80 }, (_, i) => `e2e-chat-${String(i + 1).padStart(3, "0")}`)] },
        { id: "e2e-deepseek", protocol: "openai", name: "回归DeepSeek", baseUrl: "http://127.0.0.1:18082/v1", apiKey: "e2e-mock-key", models: ["deepseek-flash"] },
    ],
    models: ["gpt-image-2", "chatgpt-image-latest-extra-long-preview", ...Array.from({ length: 80 }, (_, i) => `e2e-chat-${String(i + 1).padStart(3, "0")}`), "deepseek-flash"],
    imageModels: ["gpt-image-2"],
    imageModel: "gpt-image-2",
    model: "gpt-image-2",
    imageChannelId: "e2e-model",
};

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const screens = fileURLToPath(new URL("./screens/", import.meta.url));
const credentialsFile = new URL("./.credentials.local.json", import.meta.url);
let credentials = {};
try {
    credentials = JSON.parse(await readFile(credentialsFile, "utf8"));
} catch (error) {
    if (error.code !== "ENOENT") throw new Error("本地凭据文件不是有效 JSON");
}
const username = process.env.E2E_USERNAME || credentials.username || "qatester";
const password = process.env.E2E_PASSWORD || credentials.password;
const modifier = process.platform === "darwin" ? "Meta" : "Control";
const results = [];
const panelSamples = {};
const runtimeErrors = [];
let browser,
    context,
    page,
    projectId,
    projectTitle,
    currentCheckName = null,
    navigationStarted = false;
let preparationErrors = null;
const createdProjects = [];
const remainingProjectIds = [];
let image, text;
function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const name = Buffer.from(type);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, checksum]);
}
function makeLargePng(index) {
    const width = 2000, height = 1500;
    const color = [index * 37 % 256, index * 83 % 256, index * 131 % 256];
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
        row[1 + x * 3] = color[0];
        row[2 + x * 3] = color[1];
        row[3 + x * 3] = color[2];
    }
    const pixels = Buffer.alloc(row.length * height);
    for (let y = 0; y < height; y++) row.copy(pixels, y * row.length);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
}
function makeZip(entries) {
    const local = [], central = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        const compressed = deflateRawSync(data);
        const checksum = crc32(data);
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x800, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(name.length, 26);
        local.push(localHeader, name, compressed);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x800, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(name.length, 28);
        centralHeader.writeUInt32LE(offset, 42);
        central.push(centralHeader, name);
        offset += localHeader.length + name.length + compressed.length;
    }
    const centralSize = central.reduce((size, part) => size + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, ...central, end]);
}
const clean = (value) => {
    const message = String(value);
    return (password ? message.split(password).join("[已隐藏]") : message)
        .replace(/\x1b\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
        .slice(0, 450);
};
class Skip extends Error {}
const nodes = () => page.locator("[data-node-id]");
// 画布没有 aria 属性，使用已有的内联变换标记；不依赖 CSS module 类名。
const world = () => page.locator('div[style*="--canvas-inverse-scale"]');
const dock = () => page.getByLabel("画布控制", { exact: true });
const prompt = () => page.getByRole("textbox", { name: "生成提示词", exact: true });
const panel = () => prompt().locator("xpath=ancestor::*[@data-canvas-no-zoom][1]");
const node = (id) => page.locator(`[data-node-id="${id}"]`);
const rect = async (locator) => {
    const box = await locator.boundingBox();
    assert(box, "元素未显示");
    return box;
};
async function eventually(check, reason, timeout = 5000) {
    const deadline = Date.now() + timeout;
    let last;
    do {
        try {
            if (await check()) return;
        } catch (error) {
            last = error;
        }
        await page.waitForTimeout(40);
    } while (Date.now() < deadline);
    throw new Error(`${reason}${last ? `：${last.message}` : ""}`);
}
async function transform(locator) {
    return locator.evaluate((el) => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return { x: m.e, y: m.f, k: m.a };
    });
}
async function drag(from, to) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    try {
        await page.mouse.move(to.x, to.y, { steps: 24 });
    } finally {
        await page.mouse.up();
    }
    await page.waitForTimeout(80);
}
async function blankPoint() {
    const box = await rect(world().locator(".."));
    return page.evaluate((b) => {
        for (let y = b.y + 80; y < b.y + b.height - 100; y += 80) {
            for (let x = b.x + 100; x < b.x + b.width - 100; x += 100) {
                const el = document.elementFromPoint(x, y);
                if (el && !el.closest('[data-node-id],[data-connection-id],[data-canvas-no-zoom],button,input,textarea,[contenteditable="true"],nav,aside,[role="dialog"],[role="listbox"]')) return { x, y };
            }
        }
        throw new Error("找不到画布空白处");
    }, box);
}
async function blank() {
    const point = await blankPoint();
    await page.mouse.click(point.x, point.y);
}
async function select(id) {
    const b = await rect(node(id));
    // 节点头部不含文本编辑器，也避开四角缩放手柄和两侧端口。
    await page.mouse.click(b.x + b.width / 2, b.y + 20);
}
async function openPrompt(id) {
    await select(id);
    await prompt().waitFor({ state: "visible" });
}
async function add(kind, position) {
    const previous = new Set(await nodes().evaluateAll((es) => es.map((e) => e.dataset.nodeId)));
    await page.getByRole("navigation", { name: "画布工具" }).getByRole("button", { name: kind, exact: true }).click();
    await eventually(async () => (await nodes().count()) > previous.size, `${kind}节点未创建`);
    const id = (await nodes().evaluateAll((es) => es.map((e) => e.dataset.nodeId))).find((id) => !previous.has(id));
    await blank();
    const b = await rect(node(id));
    await drag({ x: b.x + b.width / 2, y: b.y + 20 }, { x: position.x + b.width / 2, y: position.y + 20 });
    await blank();
    return id;
}
async function pair() {
    text = await add("文本", { x: 180, y: 170 });
    image = await add("图片", { x: 850, y: 170 });
}
async function connect(from = text, to = image) {
    await blank();
    const a = await rect(node(from));
    const b = await rect(node(to));
    const count = await page.locator("[data-connection-id]").count();
    await drag({ x: a.x + a.width, y: a.y + a.height / 2 }, { x: b.x, y: b.y + b.height / 2 });
    await eventually(async () => (await page.locator("[data-connection-id]").count()) === count + 1, "端口拖动后未创建连线");
}
async function editText(id, value) {
    await blank();
    const b = await rect(node(id));
    await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
    const editor = node(id).locator("textarea");
    await editor.waitFor({ state: "visible" });
    await editor.fill(value);
    await blank();
    await eventually(async () => (await node(id).innerText()).includes(value), "文本节点编辑未保存");
}
async function promptValue() {
    return (await prompt().innerText()).trim();
}
async function expectPrompt(value) {
    await eventually(async () => (await promptValue()) === value, `提示词应为「${value}」`);
}
async function disconnect() {
    await blank();
    const path = page.locator("[data-connection-id]").first();
    const middle = await path.evaluate((el) => {
        const p = el.getPointAtLength(el.getTotalLength() / 2);
        const screen = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
        return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(middle.x, middle.y);
    await page.keyboard.press("Delete");
    await eventually(async () => (await page.locator("[data-connection-id]").count()) === 0, "Delete 未断开连线");
}
async function togglePanel(name, open) {
    const button = dock().getByRole("button", { name, exact: true });
    if ((await button.getAttribute("aria-pressed")) !== String(open)) await button.click();
    await page.waitForTimeout(650);
}
async function reset() {
    await page.keyboard.press("Escape");
    await togglePanel("素材库", false);
    await togglePanel("助手", false);
    await blank();
    for (const id of await nodes().evaluateAll((es) => es.map((e) => e.dataset.nodeId))) {
        await select(id);
        await page.keyboard.press("Delete");
        await eventually(async () => (await node(id).count()) === 0, "清理上一项节点失败");
    }
    await blank();
}
async function screenshot(index) {
    const path = `${screens}${String(index).padStart(2, "0")}.png`;
    await page.screenshot({ path, fullPage: true, timeout: 10000 });
    return path;
}
async function run(name, action, resetFirst = false) {
    const index = results.length + 1;
    const started = Date.now();
    const errorsBefore = runtimeErrors.length;
    const result = { name, status: "passed" };
    currentCheckName = name;
    try {
        if (resetFirst) await reset();
        await action();
        await page?.waitForTimeout(180);
    } catch (error) {
        result.status = error instanceof Skip ? "skipped" : "failed";
        result.reason = clean(error.message);
    }
    const checkErrors = runtimeErrors.slice(errorsBefore).filter((error) => error.type !== "badscript");
    if (checkErrors.length) {
        result.status = "failed";
        result.reason = `页面报错：${checkErrors
            .map((e) => e.message)
            .join("；")}`;
    }
    if (page && !page.isClosed()) {
        try {
            result.screenshot = await screenshot(index);
        } catch (error) {
            result.status = "failed";
            result.reason = `截图失败：${clean(error.message)}`;
        }
    }
    result.durationMs = Date.now() - started;
    results.push(result);
    console.log(`${result.status === "failed" ? "❌" : "✅"} ${name}${result.status === "skipped" ? `（跳过：${result.reason}）` : result.reason ? `（${result.reason}）` : ""}`);
    currentCheckName = null;
    return result.status === "passed";
}

async function loginAndCreate() {
    navigationStarted = true;
    await page.goto(`${baseURL}/canvas`, { waitUntil: "domcontentloaded" });
    if (password || new URL(page.url()).pathname === "/login") {
        assert(password, "需要登录：请设置 E2E_PASSWORD 或本地凭据文件");
        await page.goto(`${baseURL}/login?redirect=/canvas`, { waitUntil: "networkidle" });
        await page.getByLabel("用户名或邮箱", { exact: true }).fill(username);
        await page.getByLabel("密码", { exact: true }).fill(password);
        await page.getByRole("button", { name: /^登\s*录$/ }).click();
        await page.waitForURL((url) => url.pathname === "/canvas", { timeout: 15000 });
    }
    const token = await page.evaluate(() => {
        const persisted = localStorage.getItem("infinite-canvas-auth-token-v1");
        return persisted ? JSON.parse(persisted)?.state?.token : "";
    });
    assert(token, "登录后未能从 localStorage 读取令牌");
    const configResponse = await page.request.post(new URL("/api/v1/user-config/model", baseURL).href, {
        headers: { Authorization: `Bearer ${token}` },
        data: { config: testModelConfig },
    });
    assert(configResponse.ok(), `测试接口配置写入账号失败（${configResponse.status()}）`);
    await page.reload({ waitUntil: "networkidle" });
    const hasTestChannel = await page.evaluate(() => {
        const stored = localStorage.getItem("infinite-canvas:ai_config_store");
        if (!stored) return false;
        try {
            const config = JSON.parse(stored)?.state?.config;
            return config?.localChannels?.some((channel) => channel.name === "回归DeepSeek") ?? false;
        } catch {
            return false;
        }
    });
    assert(hasTestChannel, "测试接口配置未写入账号");
    await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
    await page.waitForURL(/\/canvas\/[^/?]+$/);
    projectId = new URL(page.url()).pathname.split("/").at(-1);
    const project = { id: projectId, title: "" };
    createdProjects.push(project);
    await dock().waitFor({ state: "visible" });
    projectTitle = await page.getByTitle("双击修改画布名称", { exact: true }).innerText();
    project.title = projectTitle;
    await page.getByTitle("双击修改画布名称", { exact: true }).dblclick();
    const title = page.getByRole("textbox", { name: "画布名称", exact: true });
    const uniqueTitle = `E2E 回归 ${Date.now()} ${projectId}`;
    await title.fill(uniqueTitle);
    await title.press("Enter");
    await eventually(async () => (await page.getByTitle("双击修改画布名称", { exact: true }).innerText()) === uniqueTitle, "测试画布命名失败");
    projectTitle = uniqueTitle;
    project.title = uniqueTitle;
}
async function warmup() {
    const deadline = Date.now() + 60000;
    const urls = [`${baseURL}/`, `${baseURL}/canvas`];
    let lastError;
    while (Date.now() < deadline) {
        let ready = true;
        for (const url of urls) {
            const timeout = Math.max(1000, deadline - Date.now());
            try {
                const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
                if (!response || response.status() !== 200) throw new Error(`${url} 返回 ${response?.status() ?? "无响应"}`);
                await page.locator("body").waitFor({ state: "visible", timeout: Math.max(1000, deadline - Date.now()) });
                const loaded = await page.evaluate(() => document.readyState === "interactive" || document.readyState === "complete");
                if (!loaded) throw new Error(`${url} 页面尚未加载完成`);
            } catch (error) {
                lastError = error;
                ready = false;
                break;
            }
        }
        if (ready) return;
        if (Date.now() < deadline) await page.waitForTimeout(Math.min(1000, deadline - Date.now()));
    }
    throw new Error(`网站预热 60 秒仍未就绪：${clean(lastError?.message || "未知错误")}`);
}
async function prepareWithRetries() {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
            console.log(`准备失败，重新打开页面重试（${attempt}/2）`);
            if (page && !page.isClosed()) await page.close().catch(() => {});
            page = await context.newPage();
            page.setDefaultTimeout(8000);
            page.setDefaultNavigationTimeout(20000);
        }
        const errors = [];
        preparationErrors = errors;
        page.__preparationErrors = errors;
        try {
            if (attempt === 0) await warmup();
            await loginAndCreate();
            preparationErrors = null;
            page.__preparationErrors = null;
            runtimeErrors.push(...errors);
            return;
        } catch (error) {
            lastError = error;
            preparationErrors = null;
        }
    }
    throw new Error(`准备步骤重试 2 次后仍失败：${clean(lastError?.message || "未知错误")}`);
}
async function deleteProject() {
    const projects = [...createdProjects];
    for (const project of projects) {
        // 只按本次创建的 ID 对应标题定位，不删除已有项目。
        await page.goto(`${baseURL}/canvas`, { waitUntil: "domcontentloaded" });
        let card = page.locator("article").filter({ has: page.getByRole("button", { name: `打开${project.title}`, exact: true }) });
        let found = true;
        try {
            await card.waitFor({ state: "visible" });
        } catch {
            found = false;
        }
        if (!found) {
            await page.reload({ waitUntil: "domcontentloaded" });
            await page.getByRole("button", { name: "新建项目", exact: true }).first().waitFor();
            card = page.locator("article").filter({ has: page.getByRole("button", { name: `打开${project.title}`, exact: true }) });
            try {
                await card.waitFor({ state: "visible" });
                found = true;
            } catch {
                found = false;
            }
        }
        if (!found) {
            remainingProjectIds.push(project.id);
            continue;
        }
        const matchingCount = await page.getByRole("button", { name: `打开${project.title}`, exact: true }).count();
        await card.getByRole("button", { name: `${project.title}更多操作`, exact: true }).click();
        await page.getByRole("menuitem", { name: "删除项目", exact: true }).click();
        await page.getByRole("button", { name: "确认删除", exact: true }).click();
        await card.waitFor({ state: "detached" });
        // 重载确认持久化删除，而非只消失在当前渲染中。
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "新建项目", exact: true }).first().waitFor();
        assert.equal(await page.getByRole("button", { name: `打开${project.title}`, exact: true }).count(), matchingCount - 1, `测试画布删除未持久化：${project.id}`);
        const index = createdProjects.findIndex((item) => item.id === project.id);
        if (index >= 0) createdProjects.splice(index, 1);
    }
    if (remainingProjectIds.length) throw new Skip(`列表刷新后仍找不到测试画布，可能残留 ID：${remainingProjectIds.join("、")}`);
    projectId = undefined;
}

async function samplePanel(name, resizeLabel, opening) {
    const button = dock().getByRole("button", { name, exact: true });
    const handle = page.getByRole("button", { name: resizeLabel, exact: true });
    if (!opening) assert.equal(await button.getAttribute("aria-pressed"), "true");
    // requestAnimationFrame 从真实点击事件开始采样，避免 click 等待丢掉动画前段。
    await button.evaluate((el, label) => {
        window.__regressionWidths = null;
        el.addEventListener(
            "click",
            () => {
                const start = performance.now();
                const samples = [];
                const tick = () => {
                    const h = document.querySelector(`button[aria-label="${label}"]`);
                    const shell = h?.closest("aside")?.parentElement;
                    samples.push({ ms: performance.now() - start, width: shell?.getBoundingClientRect().width || 0 });
                    if (performance.now() - start < 800) requestAnimationFrame(tick);
                    else window.__regressionWidths = samples;
                };
                tick();
            },
            { once: true },
        );
    }, resizeLabel);
    await button.click();
    await eventually(async () => page.evaluate(() => window.__regressionWidths !== null), "宽度采样未完成");
    const samples = await page.evaluate(() => window.__regressionWidths);
    const max = Math.max(...samples.map((s) => s.width));
    assert(max > 200, "侧栏未展开到正常宽度");
    const intermediate = samples.filter((s) => s.width > 2 && s.width < max - 2);
    assert(new Set(intermediate.map((s) => Math.round(s.width))).size >= 3, `宽度没有逐步变化：${JSON.stringify(samples)}`);
    for (let i = 1; i < samples.length; i++) {
        const delta = samples[i].width - samples[i - 1].width;
        assert(opening ? delta >= -2 : delta <= 2, "侧栏动画宽度不单调");
    }
    const end = samples.at(-1).width;
    assert(opening ? end > 200 : end < 2, "侧栏开关最终宽度不正确");
    const settled = samples.find((s) => s.ms >= 150 && (opening ? s.width >= max - 2 : s.width < 2));
    assert(settled && settled.ms <= 650, "侧栏未在约 0.5 秒内完成动画");
    assert.equal(await button.getAttribute("aria-pressed"), String(opening));
    if (opening) await handle.waitFor({ state: "visible" });
    return samples;
}
async function assertContained(container) {
    const b = await rect(container);
    const buttons = container.locator("button");
    assert((await buttons.count()) > 0, "未找到按钮");
    for (const item of await buttons.all()) {
        const r = await rect(item);
        const label = (await item.getAttribute("aria-label")) || (await item.innerText());
        assert(r.x >= b.x - 1 && r.y >= b.y - 1 && r.x + r.width <= b.x + b.width + 1 && r.y + r.height <= b.y + b.height + 1, `${label} 超出外框`);
    }
}

async function openImageSettings(id) {
    await openPrompt(id);
    await panel().getByRole("button", { name: /·.*张/ }).click();
    const settings = page.locator(".canvas-image-settings-popover").last();
    await settings.getByText(/^(宽高比|比例)$/).first().waitFor({ state: "visible" });
    return settings;
}
async function openVideoSettings(id) {
    await openPrompt(id);
    await panel().getByRole("button", { name: /·.*s$/ }).click();
    const settings = page.locator(".canvas-image-settings-popover").last();
    await settings.getByText(/^(宽高比|比例)$/).first().waitFor({ state: "visible" });
    return settings;
}
function optionButtons(settings, label) {
    return (typeof label === "string" ? settings.getByText(label, { exact: true }) : settings.getByText(label).first()).locator("xpath=..").locator("button");
}
async function assertAspectAndQuality(settings, allowedQualities) {
    const aspectButtons = optionButtons(settings, /^(宽高比|比例)$/);
    const aspects = (await aspectButtons.allInnerTexts()).map((label) => label.trim());
    assert(aspects.length >= 3, `宽高比按钮不足 3 个：${aspects.join("、")}`);
    assert(aspects.length <= 9, `比例按钮超过 9 个，应只留常用：${aspects.join("、")}`);
    assert(aspects.every((label) => /^\d+:\d+$/.test(label) || label === "自适应"), `宽高比按钮文字不符合新样式：${aspects.join("、")}`);
    const qualityButtons = optionButtons(settings, "清晰度");
    const qualities = (await qualityButtons.allInnerTexts()).map((label) => label.trim());
    assert(qualities.length > 0 && qualities.every((label) => (allowedQualities instanceof RegExp ? allowedQualities.test(label) : allowedQualities.includes(label))), `清晰度按钮文字不符合新样式：${qualities.join("、")}`);
    assert.equal(await settings.locator('input[type="number"]').count(), 0, "设置弹窗仍有可输入数字的宽/高框");
}
async function assertDurationSlider(settings) {
    const slider = settings.getByRole("slider");
    assert.equal(await slider.count(), 1, "视频设置弹窗应有一个秒数滑杆");
    const min = Number(await slider.getAttribute("aria-valuemin"));
    const max = Number(await slider.getAttribute("aria-valuemax"));
    assert(Number.isFinite(min) && Number.isFinite(max) && min < max, "秒数滑杆范围无效");
    const value = async () => Number(await slider.getAttribute("aria-valuenow"));
    await slider.focus();
    await page.keyboard.press("End");
    await eventually(async () => (await value()) === max, "秒数滑杆按 End 未到最大值");
    await page.keyboard.press("Home");
    await eventually(async () => (await value()) === min, "秒数滑杆按 Home 未到最小值");
    await page.keyboard.press("ArrowRight");
    await eventually(async () => (await value()) > min, "秒数滑杆按 → 后值没有变大");
}

const checks = [
    [
        "① 空白处左键拖动平移",
        async () => {
            image = await add("图片", { x: 850, y: 170 });
            const before = await transform(world());
            const n = await transform(node(image));
            const p = await blankPoint();
            await drag(p, { x: p.x + 90, y: p.y + 60 });
            const after = await transform(world());
            assert(Math.abs(after.x - before.x - 90) < 3 && Math.abs(after.y - before.y - 60) < 3, "空白拖动没有按距离平移");
            assert.deepEqual(await transform(node(image)), n, "平移改变了节点世界坐标");
        },
    ],
    [
        "② 多步拖节点，画布不动",
        async () => {
            image = await add("图片", { x: 850, y: 170 });
            const view = await transform(world());
            const b = await rect(node(image));
            await drag({ x: b.x + b.width / 2, y: b.y + 20 }, { x: b.x + b.width / 2 + 80, y: b.y + 65 });
            const after = await rect(node(image));
            assert(Math.abs(after.x - b.x - 80) < 3 && Math.abs(after.y - b.y - 45) < 3, "节点未按拖动距离移动");
            assert.deepEqual(await transform(world()), view, "拖节点时画布发生平移或缩放");
        },
    ],
    [
        "③ 从端口拖到另一节点连线",
        async () => {
            await pair();
            await connect();
        },
    ],
    [
        "④ 单击图片，提示词框在正下方",
        async () => {
            image = await add("图片", { x: 850, y: 170 });
            await openPrompt(image);
            const n = await rect(node(image));
            const p = await rect(panel());
            assert(Math.abs(p.x + p.width / 2 - n.x - n.width / 2) < 3, "提示词框未水平居中对齐节点");
            assert(Math.abs(p.y - n.y - n.height - 12) < 4, "提示词框未紧随节点底部");
        },
    ],
    [
        "⑤ 点空白关框，再单击重新出现",
        async () => {
            image = await add("图片", { x: 850, y: 170 });
            await openPrompt(image);
            await blank();
            await prompt().waitFor({ state: "hidden" });
            await openPrompt(image);
        },
    ],
    [
        "⑥ Delete 删除节点",
        async () => {
            image = await add("图片", { x: 850, y: 170 });
            await select(image);
            await page.keyboard.press("Delete");
            await node(image).waitFor({ state: "detached" });
            assert.equal(await nodes().count(), 0, "Delete 后仍有节点");
        },
    ],
    [
        "⑥ ⌘C/⌘V 复制粘贴",
        async () => {
            image = await add("图片", { x: 850, y: 170 });
            try {
                await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL).origin });
                await page.evaluate(() => navigator.clipboard.readText());
            } catch (error) {
                if (/NotAllowed|denied|permission|not supported|Unknown permission/i.test(error.message)) throw new Skip("读剪贴板权限被拒");
                throw error;
            }
            await select(image);
            await page.keyboard.press(`${modifier}+c`);
            await page.keyboard.press(`${modifier}+v`);
            await eventually(async () => (await nodes().count()) === 2, "复制粘贴未生成第二个节点");
            const ids = await nodes().evaluateAll((es) => es.map((e) => e.dataset.nodeId));
            const copy = ids.find((id) => id !== image);
            assert(copy && copy !== image, "副本没有独立节点 ID");
        },
    ],
    [
        "⑦ 尺寸/清晰度菜单打开",
        async () => {
            image = await add("图片", { x: 850, y: 170 });
            await openPrompt(image);
            await panel().getByRole("button", { name: /·.*张/ }).click();
            await page.getByText("清晰度", { exact: true }).waitFor({ state: "visible" });
            await page.getByText(/^(宽高比|比例)$/).first().waitFor({ state: "visible" });
        },
    ],
    [
        "⑦ 摄像机菜单打开",
        async () => {
            image = await add("图片", { x: 850, y: 170 });
            await openPrompt(image);
            await panel().getByRole("button", { name: "摄像机", exact: true }).click();
            await page.getByRole("heading", { name: "摄像机", exact: true }).waitFor({ state: "visible" });
            await page.getByRole("switch", { name: "摄像机控制", exact: true }).waitFor({ state: "visible" });
        },
    ],
    [
        "⑦ 模型菜单打开",
        async () => {
            image = await add("图片", { x: 850, y: 170 });
            await openPrompt(image);
            await panel().getByRole("combobox").click();
            await page.getByRole("listbox").waitFor({ state: "visible" });
            assert((await page.getByRole("option").count()) > 0, "模型菜单没有选项");
        },
    ],
    [
        "⑧ 连线同步、跟随修改、保留原字、断线撤掉",
        async () => {
            await pair();
            await editText(text, "源文本甲");
            await openPrompt(image);
            await prompt().fill("框里原有字");
            await blank();
            await connect();
            await openPrompt(image);
            await expectPrompt("框里原有字\n源文本甲");
            await editText(text, "源文本乙");
            await openPrompt(image);
            await expectPrompt("框里原有字\n源文本乙");
            await disconnect();
            await openPrompt(image);
            await expectPrompt("框里原有字");
        },
    ],
    [
        "⑨ 手改同步字后，源文本再改不覆盖",
        async () => {
            await pair();
            await editText(text, "同步原文甲");
            await openPrompt(image);
            await prompt().fill("原有保留字");
            await blank();
            await connect();
            await openPrompt(image);
            await expectPrompt("原有保留字\n同步原文甲");
            await prompt().fill("原有保留字\n用户手改内容");
            await blank();
            await editText(text, "同步更新乙");
            await openPrompt(image);
            await expectPrompt("原有保留字\n用户手改内容");
            await prompt().fill("原有保留字");
            await blank();
            await editText(text, "同步更新丙");
            await openPrompt(image);
            await expectPrompt("原有保留字");
        },
    ],
    [
        "⑩ 极速输入 40 字再连按 40 次退格",
        async () => {
            text = await add("文本", { x: 400, y: 170 });
            const b = await rect(node(text));
            await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
            const editor = node(text).locator("textarea");
            await editor.fill("");
            await editor.pressSequentially("极".repeat(40), { delay: 0 });
            assert.equal(await editor.inputValue(), "极".repeat(40), "极速输入有丢字");
            for (let i = 0; i < 40; i++) await page.keyboard.press("Backspace");
            assert.equal(await editor.inputValue(), "", "连续退格未清空正文");
            await page.waitForTimeout(500);
            await blank();
            assert((await node(text).innerText()).includes("双击编辑文字"), "空正文未保存");
        },
    ],
    [
        "⑪ 素材库开关，宽度逐步变化",
        async () => {
            const open = await samplePanel("素材库", "调整左侧面板宽度", true);
            const close = await samplePanel("素材库", "调整左侧面板宽度", false);
            panelSamples.assets = { open, close };
        },
    ],
    [
        "⑪ 助手开关，宽度逐步变化",
        async () => {
            const open = await samplePanel("助手", "调整右侧面板宽度", true);
            const close = await samplePanel("助手", "调整右侧面板宽度", false);
            panelSamples.assistant = { open, close };
        },
    ],
    [
        "⑫ 底部按钮在外框内、助手输入按钮不重叠",
        async () => {
            await assertContained(dock());
            await togglePanel("助手", true);
            await assertContained(dock());
            const editor = page.getByRole("textbox", { name: "描述创作目标，或让我继续操作画布", exact: true });
            await editor.waitFor({ state: "visible" });
            const composer = editor.locator('xpath=ancestor::div[.//button[@aria-label="发送" or @aria-label="停止"]][1]');
            const buttons = composer.getByRole("button");
            const boxes = [];
            for (const button of await buttons.all()) {
                if (await button.isVisible()) boxes.push({ label: (await button.getAttribute("aria-label")) || (await button.innerText()), ...(await rect(button)) });
            }
            assert(boxes.length >= 4, "助手输入栏底部按钮未完整定位");
            await assertContained(composer);
            for (let i = 0; i < boxes.length; i++)
                for (let j = i + 1; j < boxes.length; j++) {
                    const a = boxes[i],
                        b = boxes[j];
                    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
                    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
                    assert(overlapX <= 1 || overlapY <= 1, `${a.label} 与 ${b.label} 重叠`);
                }
        },
    ],
    [
        "⑭ 助手模型按钮：文字/图片/视频三项",
        async () => {
            await togglePanel("助手", true);
            const button = page.getByRole("button", { name: "助手模型", exact: true });
            await button.click();
            for (const label of ["文字模型", "图片模型", "视频模型"]) {
                const el = page.getByText(new RegExp("^" + label)).first();
                await el.waitFor({ state: "visible" });
                const box = await rect(el);
                const viewport = page.viewportSize();
                assert(box.y >= 0 && box.y + box.height <= viewport.height, `${label} 超出屏幕`);
            }
            await page.getByText("添加或管理接口", { exact: true }).first().waitFor({ state: "visible" });
            const modelPanel = page.locator(".ant-popover:visible").filter({ hasText: "文字模型" }).last();
            await modelPanel.locator(".ant-select").nth(3).click();
            const longOption = page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: "chatgpt-image-latest-extra-long-preview" }).first();
            await longOption.waitFor({ state: "visible" });
            assert.equal((await longOption.innerText()).trim(), "chatgpt-image-latest-extra-long-preview", "长模型名在列表里被截断");
            const truncated = await longOption.evaluate((el) => { const c = el.querySelector(".ant-select-item-option-content") || el; return c.scrollWidth > c.clientWidth + 1; });
            assert(!truncated, "长模型名在列表里显示不全");
            await page.waitForTimeout(500);
            await page.screenshot({ path: screens + "agent-model-menu.png" });
            await page.keyboard.press("Escape");
        },
    ],
    [
        "⑮ 助手里『添加或管理接口』能打开并操作设置",
        async () => {
            await togglePanel("助手", true);
            await page.getByRole("button", { name: "助手模型", exact: true }).click();
            await page.getByText("添加或管理接口", { exact: true }).first().click();
            const dialog = page.getByRole("dialog").filter({ hasText: "接入新模型" }).last();
            await dialog.waitFor({ state: "visible" });
            await page.waitForTimeout(600);
            await eventually(async () => !(await page.getByText("添加或管理接口", { exact: true }).first().isVisible()), "打开设置后助手模型面板仍盖在上面");
            const done = dialog.getByRole("button", { name: /完\s*成/ }).last();
            const doneBox = await rect(done);
            const hit = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return el && el.closest('[role="dialog"]') ? "dialog" : el ? el.outerHTML.slice(0, 160) : "none"; }, { x: doneBox.x + doneBox.width / 2, y: doneBox.y + doneBox.height / 2 });
            assert.equal(hit, "dialog", `设置窗口『完成』按钮被遮住：${hit}`);
            await dialog.getByRole("button", { name: /接入新模型/ }).click();
            await page.waitForTimeout(600);
            await page.screenshot({ path: screens + "agent-config-dialog.png" });
            const input = page.locator('[role="dialog"] input[type="text"]:visible, [role="dialog"] input:not([type]):visible').first();
            await input.click();
            await page.keyboard.type("abc");
            await eventually(async () => (await input.inputValue()).includes("abc"), "设置窗口里的输入框打不进字");
            for (let i = 0; i < 4; i++) {
                const close = page.locator(".ant-drawer-close:visible, .ant-modal-close:visible");
                if (!(await close.count())) break;
                await close.last().click();
                await page.waitForTimeout(500);
            }
            await eventually(async () => (await page.locator(".ant-drawer-close:visible, .ant-modal-close:visible").count()) === 0, "设置窗口关不掉");
        },
    ],
    [
        "⑯ 助手模型：选接口、列表能滚、设置里一键用到助手",
        async () => {
            await togglePanel("助手", true);
            const button = page.getByRole("button", { name: "助手模型", exact: true });
            await button.click();
            await page.getByText(/^文字模型/).first().waitFor({ state: "visible" });
            const panelRoot = page.locator(".ant-popover:visible").filter({ hasText: "文字模型" }).last();
            const selects = panelRoot.locator(".ant-select");
            await eventually(async () => (await selects.count()) >= 6, "每行应有接口、模型两个下拉");
            await selects.nth(1).click();
            const dropdown = page.locator(".ant-select-dropdown:visible").last();
            await dropdown.waitFor({ state: "visible" });
            const firstVisible = () => dropdown.evaluate((root) => { const box = root.getBoundingClientRect(); const items = [...root.querySelectorAll(".ant-select-item-option")].filter((n) => { const r = n.getBoundingClientRect(); return r.bottom > box.top + 4 && r.top < box.bottom; }); return items[0]?.textContent || ""; });
            const before = await firstVisible();
            assert(before, "文字模型列表没有选项");
            const hb = await rect(dropdown);
            await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
            await page.mouse.wheel(0, 600);
            await eventually(async () => (await firstVisible()) !== before, "文字模型列表用滚轮滚不动");
            await page.keyboard.press("Escape");
            await selects.nth(0).click();
            await page.locator(".ant-select-item-option:visible").filter({ hasText: "回归DeepSeek" }).first().click();
            await eventually(async () => (await selects.nth(1).innerText()).includes("deepseek-flash"), "换成回归DeepSeek接口后模型没自动变成 deepseek-flash");
            await page.getByText("添加或管理接口", { exact: true }).first().click();
            await page.getByText("点一个接口，用到画布助手").first().waitFor({ state: "visible" });
            await page.getByRole("button", { name: "用作文字模型" }).first().click();
            await eventually(async () => !(await page.getByText("点一个接口，用到画布助手").first().isVisible()), "点『用作文字模型』后设置窗口没关");
            await button.click();
            await eventually(async () => (await page.locator(".ant-popover:visible").filter({ hasText: "文字模型" }).last().locator(".ant-select").nth(0).innerText()).length > 0, "面板未显示接口");
            await page.screenshot({ path: screens + "agent-model-channel.png" });
            await page.keyboard.press("Escape");
        },
    ],
    [
        "⑰ 助手发消息走所选接口（选回归DeepSeek就只打到它）",
        async () => {
            await togglePanel("助手", true);
            await page.getByRole("button", { name: "助手模型", exact: true }).click();
            const panelRoot = page.locator(".ant-popover:visible").filter({ hasText: "文字模型" }).last();
            const selects = panelRoot.locator(".ant-select");
            await eventually(async () => (await selects.count()) >= 6, "模型面板没打开");
            await selects.nth(0).click();
            await page.locator(".ant-select-item-option:visible").filter({ hasText: "回归DeepSeek" }).first().click();
            await eventually(async () => (await selects.nth(1).innerText()).includes("deepseek-flash"), "没切到 deepseek-flash");
            await page.keyboard.press("Escape");
            mockHits.hello.length = 0; mockHits.deepseek.length = 0;
            const editor = page.getByRole("textbox", { name: "描述创作目标，或让我继续操作画布", exact: true });
            await editor.click();
            await page.keyboard.type("哈喽");
            await page.getByRole("button", { name: "发送", exact: true }).click();
            await eventually(async () => mockHits.deepseek.length + mockHits.hello.length > 0, "助手没有发出任何文字请求", 20000);
            await page.waitForTimeout(1500);
            const helloChat = mockHits.hello.filter((h) => /chat|responses/.test(h.path));
            assert.equal(helloChat.length, 0, `文字请求打到了全局接口：${JSON.stringify(helloChat)}`);
            assert(mockHits.deepseek.some((h) => h.model === "deepseek-flash"), `所选接口没收到 deepseek-flash 请求：${JSON.stringify(mockHits)}`);
            const stop = page.getByRole("button", { name: "停止", exact: true });
            if (await stop.isVisible()) await stop.click();
        },
    ],
    [
        "⑱ 文本节点里能选中一小段文字并右键复制",
        async () => {
            text = await add("文本", { x: 300, y: 170 });
            await editText(text, "第一段内容甲乙丙丁。第二段内容戊己庚辛。");
            await blank();
            const b0 = await rect(node(text));
            await page.mouse.click(b0.x + b0.width / 2, b0.y + 12);
            await eventually(async () => (await node(text).locator('[data-selected="true"]').count()) > 0 || (await node(text).getAttribute("data-selected")) === "true", "单击后节点没被选中");
            await page.waitForTimeout(300);
            const body = node(text).getByText(/第一段内容/).first();
            const tb = await rect(body);
            // 按真人节奏：先悬停、拖到位后停一下再松手
            await page.mouse.move(tb.x + 4, tb.y + tb.height / 2);
            await page.waitForTimeout(250);
            await page.mouse.down();
            await page.mouse.move(tb.x + Math.min(tb.width * 0.4, 120), tb.y + tb.height / 2, { steps: 24 });
            await page.waitForTimeout(150);
            await page.mouse.up();
            await page.waitForTimeout(150);
            const selected = await page.evaluate(() => String(window.getSelection() || ""));
            assert(selected.length > 0 && selected.length < "第一段内容甲乙丙丁。第二段内容戊己庚辛。".length, `没选中一小段文字（选中：${JSON.stringify(selected)}）`);
            const b1 = await rect(node(text));
            assert(Math.abs(b1.x - b0.x) < 2 && Math.abs(b1.y - b0.y) < 2, "选文字时节点被拖动了");
            const selBox = await page.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
            await page.mouse.click(selBox.x, selBox.y, { button: "right" });
            await page.getByText("复制所选文字", { exact: true }).first().waitFor({ state: "visible" });
            await page.keyboard.press("Escape");
        },
    ],
    [
        "㉑ 助手输入框打拼音时灰色提示要消失",
        async () => {
            await togglePanel("助手", true);
            const editor = page.getByRole("textbox", { name: "描述创作目标，或让我继续操作画布", exact: true });
            await editor.click();
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("Input.imeSetComposition", { text: "la la", selectionStart: 5, selectionEnd: 5 });
            await page.waitForTimeout(300);
            const visibleHint = await page.evaluate(() => {
                const all = [...document.querySelectorAll("*")].filter((el) => el.children.length === 0 || getComputedStyle(el, "::before").content.includes("描述创作目标"));
                return all.some((el) => {
                    const s = getComputedStyle(el), b = getComputedStyle(el, "::before");
                    const own = el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes("描述创作目标"));
                    const pseudo = b.content && b.content.includes("描述创作目标") && b.display !== "none" && b.visibility !== "hidden" && Number(b.opacity || 1) > 0;
                    return ((own && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 && el.getClientRects().length) || pseudo);
                });
            });
            await cdp.send("Input.insertText", { text: "" });
            await page.keyboard.press("Escape");
            assert(!visibleHint, "打拼音（未上屏）时灰色提示仍显示，会和拼音重叠");
        },
    ],
    [
        "㉒ 分组彩色半透明、拖标题整组移动、可取消分组",
        async () => {
            const a = await add("文本", { x: 300, y: 220 });
            const b = await add("文本", { x: 640, y: 220 });
            await blank();
            const ra = await rect(node(a)), rb = await rect(node(b));
            await page.mouse.click(ra.x + ra.width / 2, ra.y + 12);
            await page.keyboard.down("Shift");
            await page.mouse.click(rb.x + rb.width / 2, rb.y + 12);
            await page.keyboard.up("Shift");
            await page.keyboard.press(`${modifier}+g`);
            const group = page.locator("[data-group-category]").first();
            await group.waitFor({ state: "visible" });
            const bg = await group.evaluate((el) => getComputedStyle(el).backgroundColor);
            const alpha = Number((bg.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [0, bg === "rgba(0, 0, 0, 0)" ? 0 : 1])[1]);
            assert(alpha <= 0.2, `分组底色不够透明：${bg}`);
            await blank();
            await page.screenshot({ path: screens + "group-transparent.png" });
            const title = group.locator('[data-group-title="true"]').first();
            const t0 = await rect(title), a0 = await rect(node(a)), b0 = await rect(node(b));
            await drag({ x: t0.x + 30, y: t0.y + t0.height / 2 }, { x: t0.x + 130, y: t0.y + t0.height / 2 + 60 });
            const a1 = await rect(node(a)), b1 = await rect(node(b));
            assert(Math.abs(a1.x - a0.x - 100) < 4 && Math.abs(b1.y - b0.y - 60) < 4, "拖分组标题时组内节点没一起移动");
            const t1 = await rect(title);
            await page.mouse.click(t1.x + 30, t1.y + t1.height / 2, { button: "right" });
            await page.getByText("取消分组", { exact: true }).first().click();
            await eventually(async () => (await page.locator("[data-group-category]").count()) === 0, "取消分组后分组框还在");
            assert((await node(a).count()) === 1 && (await node(b).count()) === 1, "取消分组把节点删了");
            await blank();
            const a2 = await rect(node(a));
            await drag({ x: a2.x + a2.width / 2, y: a2.y + 12 }, { x: a2.x + a2.width / 2 + 80, y: a2.y + 12 });
            const a3 = await rect(node(a)), b3 = await rect(node(b));
            assert(Math.abs(a3.x - a2.x - 80) < 4 && Math.abs(b3.x - b1.x) < 4, "取消分组后不能单独拖动");
        },
    ],
    [
        "㉓ 分组右键『整齐排列』排成网格并收紧组框",
        async () => {
            const ids = [];
            for (const pos of [{ x: 260, y: 140 }, { x: 640, y: 420 }, { x: 1000, y: 160 }]) ids.push(await add("文本", pos));
            await blank();
            const r0 = await rect(node(ids[0]));
            await page.mouse.click(r0.x + r0.width / 2, r0.y + 12);
            await page.keyboard.down("Shift");
            for (const id of ids.slice(1)) { const r = await rect(node(id)); await page.mouse.click(r.x + r.width / 2, r.y + 12); }
            await page.keyboard.up("Shift");
            await page.keyboard.press(`${modifier}+g`);
            const group = page.locator("[data-group-category]").first();
            await group.waitFor({ state: "visible" });
            const before = await rect(group);
            const title = group.locator('[data-group-title="true"]').first();
            const t = await rect(title);
            await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2, { button: "right" });
            await page.getByText("整齐排列", { exact: true }).first().click();
            await page.waitForTimeout(600);
            const after = await rect(group);
            const boxes = [];
            for (const id of ids) boxes.push(await rect(node(id)));
            assert(after.width * after.height < before.width * before.height * 0.6, `组框没收紧：前 ${Math.round(before.width)}×${Math.round(before.height)}，后 ${Math.round(after.width)}×${Math.round(after.height)}`);
            assert(Math.abs(boxes[0].y - boxes[1].y) < 3 && Math.abs(boxes[1].y - boxes[2].y) < 3, "三个节点没排在同一行");
            const xs = boxes.map((b) => b.x).sort((a, b) => a - b);
            const gaps = [xs[1] - xs[0] - boxes[0].width, xs[2] - xs[1] - boxes[0].width];
            assert(gaps.every((g) => g > 10 && g < 60), `节点间距不整齐：${gaps.map(Math.round).join(",")}`);
            for (const b of boxes) assert(b.x >= after.x - 1 && b.x + b.width <= after.x + after.width + 1 && b.y >= after.y + 30 && b.y + b.height <= after.y + after.height + 1, "有节点出了组框或压住标题");
            await blank();
            await page.screenshot({ path: screens + "group-packed.png" });
        },
    ],
    [
        "⑬ 联网按钮弹出搜索引擎菜单",
        async () => {
            await togglePanel("助手", true);
            const globe = page.getByRole("button", { name: "联网", exact: true });
            await globe.click();
            for (const text of [/^头条搜索/, "时效强·抖音红果番茄全", /^必应搜索/, "全网网页覆盖广", /^不联网$/, "只用模型自己的知识"]) {
                await (typeof text === "string" ? page.getByText(text, { exact: true }) : page.getByText(text)).first().waitFor({ state: "visible" });
            }
            const menuBox = await rect(page.getByText("只用模型自己的知识", { exact: true }).first());
            const viewport = page.viewportSize();
            assert(menuBox.y >= 0 && menuBox.y + menuBox.height <= viewport.height && menuBox.x + menuBox.width <= viewport.width, `搜索引擎菜单超出屏幕：${JSON.stringify(menuBox)}`);
            await page.waitForTimeout(600);
            const menuOpacity = await page.getByText("只用模型自己的知识", { exact: true }).first().evaluate((el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; });
            assert(menuOpacity > 0.9, `搜索引擎菜单不可见（透明度 ${menuOpacity}）`);
            await page.screenshot({ path: screens + "web-search-menu.png" });
            await page.getByText(/^不联网$/).first().click();
            await eventually(async () => (await globe.getAttribute("aria-pressed")) === "false", "选不联网后地球按钮仍高亮");
            await globe.click();
            await page.getByText(/^头条搜索/).first().click();
            await eventually(async () => (await globe.getAttribute("aria-pressed")) === "true", "选头条后地球按钮未高亮");
        },
    ],
    [
        "图片节点拉角等比无黑边",
        async () => {
            const count = await nodes().count();
            await page.evaluate(async () => {
                const canvas = document.createElement("canvas");
                canvas.width = 2752;
                canvas.height = 1536;
                const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG 生成失败")), "image/png"));
                const data = new DataTransfer();
                data.items.add(new File([blob], "wide.png", { type: "image/png" }));
                const x = innerWidth / 2, y = innerHeight / 2;
                const target = document.elementFromPoint(x, y);
                for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true, clientX: x, clientY: y }));
            });
            await eventually(async () => (await nodes().count()) > count && (await nodes().locator("img").count()) > 0, "拖入 PNG 未生成图片节点");
            image = (await nodes().evaluateAll((es) => es.find((el) => el.querySelector("img"))?.dataset.nodeId));
            assert(image, "找不到包含图片的节点");
            const img = node(image).locator("img").first();
            await eventually(async () => (await img.evaluate((el) => el.naturalWidth > 0 && el.naturalHeight > 0)), "图片预览未加载");
            const frame = img.locator("xpath=ancestor::div[.//img][1]");
            const ratio = 2752 / 1536;
            const imageRatio = await img.evaluate((el) => el.naturalWidth / el.naturalHeight);
            assert(Math.abs(imageRatio / ratio - 1) < 0.01, `图片预览比例错误：${imageRatio}`);
            const assertRatio = async () => {
                const box = await rect(frame);
                assert(Math.abs(box.width / box.height / ratio - 1) < 0.01, `图片显示框比例错误：${box.width}×${box.height}`);
            };
            const dragCorner = async (corner, dx) => {
                const n = await rect(node(image));
                const handle = node(image).locator("div.absolute.z-50.size-7");
                const centers = await handle.evaluateAll((els) => els.map((el) => {
                    const r = el.getBoundingClientRect();
                    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }));
                const target = { left: { x: n.x, y: n.y + n.height }, right: { x: n.x + n.width, y: n.y + n.height } }[corner];
                const start = centers.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0];
                assert(start, `找不到${corner === "left" ? "左下" : "右下"}角缩放手柄`);
                await drag(start, { x: start.x + dx, y: start.y });
                await assertRatio();
            };
            await dragCorner("left", -120);
            await dragCorner("left", 80);
            await dragCorner("right", 120);
            await dragCorner("right", -80);
        },
    ],
    [
        "视频设置面板",
        async () => {
            const id = await add("视频", { x: 850, y: 170 });
            const settings = await openVideoSettings(id);
            const text = await page.locator("body").innerText();
            assert(!/横屏|竖屏|方形|宽银幕|标准横屏/.test(text), "视频设置仍显示旧比例名称");
            await assertAspectAndQuality(settings, /^(\d{3,4}P|[1-8]K)$/);
            await assertDurationSlider(settings);
        },
    ],
    [
        "图片设置面板",
        async () => {
            const id = await add("图片", { x: 850, y: 170 });
            const settings = await openImageSettings(id);
            await assertAspectAndQuality(settings, /^(0\.5|1|1\.5|2|3|4)K$/);
        },
    ],
    [
        "㉔ 空白图片节点点生成后原地不动",
        async () => {
            const id = await add("图片", { x: 850, y: 170 });
            const settings = await openImageSettings(id);
            await optionButtons(settings, /^(宽高比|比例)$/).filter({ hasText: /^\s*16:9\s*$/ }).first().click();
            await page.keyboard.press("Escape");

            let previousSize = null;
            let stableSamples = 0;
            await eventually(async () => {
                const current = await rect(node(id));
                if (previousSize && Math.abs(current.width - previousSize.width) < 0.1 && Math.abs(current.height - previousSize.height) < 0.1) stableSamples++;
                else stableSamples = 0;
                previousSize = current;
                return stableSamples >= 3;
            }, "空白图片节点尺寸未稳定");
            const before = await rect(node(id));

            await openPrompt(id);
            await prompt().fill("测试");
            await panel().getByRole("button", { name: "生成", exact: true }).click();
            await page.waitForTimeout(800);

            const after = await rect(node(id));
            const dx = after.x - before.x;
            const dy = after.y - before.y;
            assert(
                Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && Math.abs(after.width - before.width) <= 2 && Math.abs(after.height - before.height) <= 2,
                `点生成后空白图片节点挪了位置 (${dx.toFixed(1)}, ${dy.toFixed(1)})`,
            );
        },
    ],
    [
        "㉕ 点过底部按钮后仍可批量删除节点",
        async () => {
            const n0 = await nodes().count();
            const selected = [];
            for (const x of [150, 650, 1150]) selected.push(await add("图片", { x, y: 240 }));
            await dock().getByRole("button", { name: "适应画面", exact: true }).click();
            await page.waitForTimeout(800);

            const boxes = await Promise.all(selected.map((id) => rect(node(id))));
            const left = Math.min(...boxes.map((b) => b.x)) - 40;
            const top = Math.min(...boxes.map((b) => b.y)) - 40;
            const right = Math.max(...boxes.map((b) => b.x + b.width)) + 40;
            const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 40;
            await page.keyboard.down("Shift");
            try {
                await page.mouse.move(left, top);
                await page.mouse.down();
                try {
                    await page.mouse.move(right, bottom, { steps: 24 });
                } finally {
                    await page.mouse.up();
                }
            } finally {
                await page.keyboard.up("Shift");
            }
            await page.keyboard.press("Delete");
            await eventually(async () => (await nodes().count()) === n0, "框选后按 Delete 没删掉");

            const pairIds = [];
            for (const x of [350, 950]) pairIds.push(await add("图片", { x, y: 240 }));
            await dock().getByRole("button", { name: "适应画面", exact: true }).click();
            await page.waitForTimeout(800);
            const first = await rect(node(pairIds[0]));
            await page.mouse.click(first.x + first.width / 2, first.y + 20);
            const second = await rect(node(pairIds[1]));
            await page.keyboard.down("Shift");
            try {
                await page.mouse.click(second.x + second.width / 2, second.y + 20);
            } finally {
                await page.keyboard.up("Shift");
            }
            await page.keyboard.press("Backspace");
            await eventually(async () => (await nodes().count()) === n0, "Shift 点选后按退格没删掉");
        },
    ],
    [
        "㉖ 删除分组连同组内节点一起删",
        async () => {
            const n0 = await nodes().count();
            const first = await add("文本", { x: 300, y: 220 });
            const second = await add("文本", { x: 640, y: 220 });
            await blank();
            const firstBox = await rect(node(first));
            const secondBox = await rect(node(second));
            await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + 12);
            await page.keyboard.down("Shift");
            await page.mouse.click(secondBox.x + secondBox.width / 2, secondBox.y + 12);
            await page.keyboard.up("Shift");
            await page.keyboard.press(`${modifier}+g`);
            const group = page.locator("[data-group-category]").first();
            await group.waitFor({ state: "visible" });
            const title = group.locator('[data-group-title="true"]').first();
            const titleBox = await rect(title);
            await page.mouse.click(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2, { button: "right" });
            const deleteButtons = page.getByRole("button", { name: "删除", exact: true });
            const visibleDeleteIndexes = await deleteButtons.evaluateAll((buttons) => buttons.flatMap((button, index) => {
                const style = getComputedStyle(button);
                return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && button.getClientRects().length ? [index] : [];
            }));
            assert(visibleDeleteIndexes.length > 0, "分组右键菜单里没有可见的删除按钮");
            await deleteButtons.nth(visibleDeleteIndexes.at(-1)).click();
            await eventually(async () => (await nodes().count()) === n0 && (await node(first).count()) === 0 && (await node(second).count()) === 0, "删除分组后组内节点还在");

            const keptFirst = await add("文本", { x: 300, y: 220 });
            const keptSecond = await add("文本", { x: 640, y: 220 });
            await blank();
            const keptFirstBox = await rect(node(keptFirst));
            const keptSecondBox = await rect(node(keptSecond));
            await page.mouse.click(keptFirstBox.x + keptFirstBox.width / 2, keptFirstBox.y + 12);
            await page.keyboard.down("Shift");
            await page.mouse.click(keptSecondBox.x + keptSecondBox.width / 2, keptSecondBox.y + 12);
            await page.keyboard.up("Shift");
            await page.keyboard.press(`${modifier}+g`);
            const keptGroup = page.locator("[data-group-category]").first();
            await keptGroup.waitFor({ state: "visible" });
            const keptTitle = keptGroup.locator('[data-group-title="true"]').first();
            const keptTitleBox = await rect(keptTitle);
            await page.mouse.click(keptTitleBox.x + keptTitleBox.width / 2, keptTitleBox.y + keptTitleBox.height / 2, { button: "right" });
            await page.getByText("取消分组", { exact: true }).first().click();
            await eventually(async () => (await page.locator("[data-group-category]").count()) === 0, "取消分组后分组框还在");
            assert((await node(keptFirst).count()) === 1 && (await node(keptSecond).count()) === 1, "取消分组把节点删了");
            for (const id of [keptFirst, keptSecond]) {
                await select(id);
                await page.keyboard.press("Delete");
                await eventually(async () => (await node(id).count()) === 0, "清理取消分组后的节点失败");
            }
            await eventually(async () => (await nodes().count()) === n0, "清理取消分组后的节点后数量不符");
        },
    ],
    [
        "㉗ 未登录访客只能看到登录页",
        async () => {
            const guestContext = await browser.newContext();
            try {
                const guestPage = await guestContext.newPage();
                guestPage.setDefaultNavigationTimeout(15000);
                for (const path of ["/", "/canvas", "/canvas/abc", "/models", "/skills", "/templates"]) {
                    await guestPage.goto(new URL(path, baseURL).href, { waitUntil: "domcontentloaded", timeout: 15000 });
                    // 登录守卫在页面加载后跳转，等它最多 15 秒
                    await guestPage.waitForURL((url) => url.pathname === "/login", { timeout: 15000 }).catch(() => undefined);
                    assert.equal(new URL(guestPage.url()).pathname, "/login", `未登录可以打开 ${path}`);
                }

                for (const path of [
                    "/api/v1/web-search",
                    "/api/v1/web-fetch",
                    "/api/ai/direct-request",
                    "/api/anonymous/files",
                ]) {
                    const response = await guestContext.request.post(new URL(path, baseURL).href, { data: {} });
                    assert([401, 403].includes(response.status()), `未登录可调用 ${path} (${response.status()})`);
                }

                await guestPage.goto(new URL("/login", baseURL).href, { waitUntil: "domcontentloaded", timeout: 15000 });
                assert.equal(new URL(guestPage.url()).pathname, "/login", "登录页不应跳走");
                await guestPage.getByRole("button", { name: /^登\s*录$/ }).waitFor({ state: "visible", timeout: 8000 });
            } finally {
                await guestContext.close();
            }
        },
    ],
    [
        "㉘ 带图片的画布导出再导入，图片完整",
        async () => {
            const count = await nodes().count();
            await page.evaluate(async () => {
                const canvas = document.createElement("canvas");
                canvas.width = 300;
                canvas.height = 200;
                const ctx = canvas.getContext("2d");
                if (!ctx) throw new Error("PNG 画布初始化失败");
                ctx.fillStyle = "#4f80d8";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG 生成失败")), "image/png"));
                const data = new DataTransfer();
                data.items.add(new File([blob], "export-test.png", { type: "image/png" }));
                const x = innerWidth / 2, y = innerHeight / 2;
                const target = document.elementFromPoint(x, y);
                for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true, clientX: x, clientY: y }));
            });
            await eventually(async () => (await nodes().count()) > count && (await nodes().locator("img").count()) > 0, "拖入 PNG 未生成图片节点");
            const imageId = await nodes().evaluateAll((es) => es.find((el) => el.querySelector("img"))?.dataset.nodeId);
            assert(imageId, "找不到包含图片的节点");
            const img = node(imageId).locator("img").first();
            await eventually(async () => (await img.evaluate((el) => el.naturalWidth)) === 300, "图片原始宽度不是 300");
            // 等图片存到服务器（节点图片地址变成 /api/files/…）
            await eventually(async () => (await img.getAttribute("src") || "").includes("/api/files/"), "图片 15 秒内没存到服务器", 15000);

            // 模拟换一台电脑登录：清掉本机画布缓存，让画布完全从服务器读回（此时图片引用是 server:）
            await page.waitForTimeout(3000);
            await page.goto(`${baseURL}/canvas`, { waitUntil: "networkidle" });
            await page.evaluate(async () => {
                const db = await new Promise((resolve, reject) => { const request = indexedDB.open("infinite-canvas"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
                const store = db.transaction("app_state", "readwrite").objectStore("app_state");
                const keys = await new Promise((resolve) => { const request = store.getAllKeys(); request.onsuccess = () => resolve(request.result); });
                const tx = db.transaction("app_state", "readwrite");
                keys.filter((key) => String(key).startsWith("infinite-canvas:canvas_store:account:")).forEach((key) => tx.objectStore("app_state").delete(key));
                await new Promise((resolve) => { tx.oncomplete = resolve; });
                db.close();
            });
            await page.goto(`${baseURL}/canvas`, { waitUntil: "networkidle" });
            const card = page.locator("article").filter({ has: page.getByRole("button", { name: `打开${projectTitle}`, exact: true }) }).first();
            await card.waitFor({ state: "visible" });
            await card.getByRole("button", { name: `${projectTitle}更多操作`, exact: true }).click();
            const downloadPromise = page.waitForEvent("download");
            await page.getByRole("menuitem", { name: "导出项目", exact: true }).click();
            const download = await downloadPromise;
            const exportPath = `${screens}export-test.zip`;
            await download.saveAs(exportPath);
            // 读压缩包清单：每个存在服务器上的素材（server:）都必须随包导出，否则换账号/换网站导入后会空图
            const exported = JSON.parse(execFileSync("unzip", ["-p", exportPath, "projects.json"]).toString());
            const exportedProject = exported.projects[0];
            const serverKeys = new Set();
            const collectKeys = (value) => {
                if (Array.isArray(value)) return value.forEach(collectKeys);
                if (!value || typeof value !== "object") return;
                if (typeof value.storageKey === "string" && value.storageKey.startsWith("server:")) serverKeys.add(value.storageKey);
                Object.values(value).forEach(collectKeys);
            };
            collectKeys(exportedProject.project.nodes);
            assert(serverKeys.size > 0, "图片还没存到服务器（storageKey 不是 server:），测不到导出问题");
            const packedKeys = new Set((exportedProject.files || []).map((item) => item.storageKey));
            const missing = [...serverKeys].filter((key) => !packedKeys.has(key));
            assert.equal(missing.length, 0, `导出压缩包缺少 ${missing.length} 个服务器素材`);
            const listing = execFileSync("unzip", ["-l", exportPath]).toString();
            assert((exportedProject.files || []).every((item) => listing.includes(item.path)), "压缩包清单里的素材文件实际不存在");

            await page.getByRole("button", { name: "导入画布", exact: true }).click();
            await page.locator('input[type="file"]').setInputFiles(exportPath);
            await page.getByText("已导入 1 个画布", { exact: true }).waitFor({ state: "visible" });
            const importedCard = page.locator("article").first();
            const importedOpen = importedCard.getByRole("button", { name: `打开${projectTitle}`, exact: true });
            await importedOpen.waitFor({ state: "visible" });
            await importedOpen.click();
            await page.waitForURL(/\/canvas\/[^/?]+$/);
            const importedId = new URL(page.url()).pathname.split("/").at(-1);
            createdProjects.push({ id: importedId, title: projectTitle });
            await eventually(async () => await nodes().locator("img").evaluateAll((els) => els.some((el) => el.naturalWidth === 300)), "导入后的图片没显示", 15000);
        },
    ],
    [
        "㉙ 导入 24 张大图的画布，页面不卡、画布用预览图",
        async () => {
            const id = `perf-${Date.now()}`;
            const title = `E2E 大图性能 ${id}`;
            const files = [];
            const imageNodes = Array.from({ length: 24 }, (_, index) => {
                const storageKey = `image:test-${index}`;
                const path = `projects/${id}/files/test-${index}.png`;
                files.push({ storageKey, path, mimeType: "image/png", bytes: 0 });
                return {
                    id: `perf-image-${index}`,
                    type: "image",
                    title: `测试大图 ${index + 1}`,
                    position: { x: (index % 6) * 340, y: Math.floor(index / 6) * 280 },
                    width: 300,
                    height: 225,
                    metadata: { content: storageKey, storageKey, mimeType: "image/png", naturalWidth: 2000, naturalHeight: 1500, status: "success" },
                };
            });
            const project = {
                id,
                title,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                nodes: imageNodes,
                connections: [],
                chatSessions: [],
                activeChatId: null,
                agentConfig: null,
                autoTitlePending: false,
                backgroundMode: "dots",
                showImageInfo: false,
                viewport: { x: 30, y: 30, k: 0.45 },
                sidePanel: { open: false, width: 380 },
                agentPanel: { open: false, width: 380 },
            };
            const entries = [];
            for (let index = 0; index < 24; index++) {
                const png = makeLargePng(index);
                files[index].bytes = png.length;
                entries.push({ name: files[index].path, data: png });
            }
            const manifest = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: [{ project, files }] };
            entries.unshift({ name: "projects.json", data: JSON.stringify(manifest) });
            const archivePath = `${screens}perf-test.zip`;
            await writeFile(archivePath, makeZip(entries));

            await page.goto(`${baseURL}/canvas`, { waitUntil: "networkidle" });
            await page.getByRole("button", { name: "导入画布", exact: true }).click();
            await page.locator('input[type="file"]').setInputFiles(archivePath);
            await page.getByText("已导入 1 个画布", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
            const importedCard = page.locator("article").filter({ has: page.getByRole("button", { name: `打开${title}`, exact: true }) }).first();
            const importedOpen = importedCard.getByRole("button", { name: `打开${title}`, exact: true });
            await importedOpen.waitFor({ state: "visible" });
            await page.evaluate(() => {
                const state = { maximum: 0, over300: 0, samples: 0, nextAt: performance.now() + 500 };
                window.__largeCanvasPerf = state;
                const sample = () => {
                    const scheduledAt = state.nextAt;
                    const timerStarted = performance.now();
                    const delay = Math.max(0, timerStarted - scheduledAt);
                    setTimeout(() => {
                        const duration = Math.max(delay, performance.now() - timerStarted);
                        state.maximum = Math.max(state.maximum, duration);
                        if (duration > 300) state.over300++;
                        state.samples++;
                        state.nextAt += 500;
                        if (state.samples < 60) setTimeout(sample, Math.max(0, state.nextAt - performance.now()));
                    }, 0);
                };
                setTimeout(sample, 500);
            });
            await importedOpen.click();
            await page.waitForURL(/\/canvas\/[^/?]+$/);
            const importedId = new URL(page.url()).pathname.split("/").at(-1);
            createdProjects.push({ id: importedId, title });
            await page.waitForTimeout(30000);
            const { maximum: maxDelay, over300: over300Count } = await page.evaluate(() => window.__largeCanvasPerf ?? { maximum: 0, over300: 0 });
            if (maxDelay > 500 || over300Count >= 3) throw new Error(`导入大画布时页面卡顿：最大延迟 ${Math.round(maxDelay)}ms，超过 300ms 的次数 ${over300Count}`);

            const imageCheck = await nodes().locator("img").evaluateAll((images) => ({
                count: images.length,
                invalid: images.filter((img) => {
                    const src = img.getAttribute("src") || "";
                    return !((src.includes("/api/files/") && /[?&]w=/.test(src)) || (src.startsWith("blob:") && img.naturalWidth <= 1024));
                }).map((img) => ({ src: img.getAttribute("src"), naturalWidth: img.naturalWidth })),
            }));
            assert.equal(imageCheck.count, 24, `画布应显示 24 张图片，实际 ${imageCheck.count} 张`);
            assert.equal(imageCheck.invalid.length, 0, "画布显示的是原图");
        },
    ],
    [
        "㉔ 作品展示页：只读、提示词、资产、聊天记录",
        async () => {
            const expectedPrompt = "展示页图片提示词测试";
            const sessionId = `e2e-showcase-${Date.now()}`;
            const sourceImage = `${sessionId}-image-a`;
            const image = `${sessionId}-image-b`;
            const textNode = `${sessionId}-text`;
            const now = new Date().toISOString();
            const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p1sAAAAASUVORK5CYII=";
            const project = {
                id: sessionId,
                title: "作品展示回归画布",
                createdAt: now,
                updatedAt: now,
                nodes: [
                    {
                        id: sourceImage,
                        type: "image",
                        title: "showcase-reference.png",
                        position: { x: 220, y: 160 },
                        width: 300,
                        height: 200,
                        metadata: { content: tinyPng, prompt: "展示页参考图", mimeType: "image/png", naturalWidth: 1, naturalHeight: 1 },
                    },
                    {
                        id: image,
                        type: "image",
                        title: "展示页目标图片",
                        position: { x: 1020, y: 160 },
                        width: 300,
                        height: 200,
                        metadata: {
                            prompt: expectedPrompt,
                            model: "gpt-image-1",
                            size: "1:1",
                            quality: "高清",
                            count: 1,
                            status: "idle",
                        },
                    },
                    {
                        id: textNode,
                        type: "text",
                        title: "展示页文本节点",
                        position: { x: 220, y: 420 },
                        width: 240,
                        height: 120,
                        metadata: { content: "作品展示回归文本" },
                    },
                ],
                connections: [
                    { id: `${sessionId}-connection-ab`, fromNodeId: sourceImage, toNodeId: image },
                ],
                chatSessions: [{
                    id: sessionId,
                    title: "作品展示回归对话",
                    messages: [
                        { id: `${sessionId}-user`, role: "user", text: "展示页用户测试句" },
                        { id: `${sessionId}-assistant`, role: "assistant", text: "展示页助手测试句" },
                    ],
                    agentState: { phase: "complete", approvedNodeIds: [], referenceNodeIds: [], pendingTaskIds: [], completedTaskIds: [] },
                    protocolMessages: [],
                    createdAt: now,
                    updatedAt: now,
                }],
                activeChatId: sessionId,
                agentConfig: null,
                autoTitlePending: false,
                backgroundMode: "dots",
                showImageInfo: false,
                viewport: { x: 0, y: 0, k: 1 },
                sidePanel: { open: true, width: 280 },
                agentPanel: { open: false, width: 380 },
            };

            const showcaseId = `e2e-showcase-${Date.now()}`;
            await page.route(`**/api/v1/showcase/${showcaseId}`, async (route) => {
                assert.equal(route.request().method(), "GET", "作品展示页应只读取展示接口");
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ code: 0, msg: "ok", data: { project, ownerName: "admin" } }),
                });
            });
            await page.goto(`${baseURL}/showcase/${showcaseId}`, { waitUntil: "domcontentloaded" });
            await page.getByRole("button", { name: "资产", exact: true }).waitFor({ state: "visible" });
            await page.getByRole("button", { name: "助手聊天记录", exact: true }).waitFor({ state: "visible" });
            assert.equal(await page.getByRole("button", { name: /生成/ }).count(), 0, "作品展示页出现了生成按钮");

            await page.locator(`[data-node-id="${image}"]`).click();
            const promptBox = page.getByRole("textbox", { name: "提示词（只读）", exact: true });
            await promptBox.waitFor({ state: "visible" });
            assert.equal(await promptBox.getAttribute("aria-readonly"), "true", "提示词框缺少只读属性");
            assert.notEqual(await promptBox.getAttribute("contenteditable"), "true", "提示词框仍可编辑");
            assert((await promptBox.innerText()).includes(expectedPrompt), "只读提示词框未显示节点提示词");
            assert.equal(await page.getByRole("textbox", { name: "生成提示词", exact: true }).count(), 0, "作品展示页出现了编辑态生成提示词框");
            const copyPromptButton = page.getByRole("button", { name: "复制提示词", exact: true });
            await copyPromptButton.waitFor({ state: "visible" });
            await copyPromptButton.click();
            await page.getByText("已复制", { exact: true }).waitFor({ state: "visible" });
            const referenceBar = page.getByText("参考资产", { exact: true }).locator("xpath=..");
            await referenceBar.getByRole("button", { name: "查看图片一：showcase-reference.png", exact: true }).waitFor({ state: "visible" });

            const beforeDrag = await rect(page.locator(`[data-node-id="${image}"]`));
            await drag(
                { x: beforeDrag.x + beforeDrag.width / 2, y: beforeDrag.y + 20 },
                { x: beforeDrag.x + beforeDrag.width / 2 + 80, y: beforeDrag.y + 60 },
            );
            const afterDrag = await rect(page.locator(`[data-node-id="${image}"]`));
            assert(Math.abs(afterDrag.x - beforeDrag.x) < 2 && Math.abs(afterDrag.y - beforeDrag.y) < 2, "只读展示页允许移动节点");

            await page.getByRole("button", { name: "资产", exact: true }).click();
            await page.getByRole("button", { name: "助手聊天记录", exact: true }).click();
            await page.getByText("展示页用户测试句", { exact: true }).waitFor({ state: "visible" });
            await page.getByText("展示页助手测试句", { exact: true }).waitFor({ state: "visible" });
            assert.equal(await page.getByRole("textbox", { name: "描述创作目标，或让我继续操作画布", exact: true }).count(), 0, "聊天记录里出现了输入框");

            await page.getByRole("button", { name: "资产", exact: true }).click();
            const firstAsset = page.locator('aside[aria-label="作品资产"] .grid button').first();
            await firstAsset.waitFor({ state: "visible" });
            await firstAsset.click();
            await page.getByRole("dialog").locator("img").waitFor({ state: "visible" });
        },
    ],
];

await mkdir(screens, { recursive: true });
try {
    browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed"), timeout: 20000 });
    context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: "no-preference" });
    // 仅给独立测试会话准备模型下拉选项；没有密钥，不请求生成服务。
    await context.addInitScript(({ origin, config }) => {
        if (location.origin !== origin) return;
        const key = "infinite-canvas:ai_config_store";
        if (!localStorage.getItem(key))
            localStorage.setItem(
                key,
                JSON.stringify({
                    state: { config },
                    version: 0,
                }),
            );
    }, { origin: new URL(baseURL).origin, config: testModelConfig });
    context.on("page", (p) => {
        p.on("pageerror", (error) => {
            const stack = String(error.stack || "")
                .replace(password ? new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : /$^/, "[已隐藏]")
                .replace(/\x1b\[[0-9;]*m/g, "")
                .slice(0, 1500);
            const item = { type: "pageerror", message: clean(error.message), stack, checkName: currentCheckName, url: p.url() };
            if (p.__preparationErrors) p.__preparationErrors.push(item);
            else runtimeErrors.push(item);
        });
        p.on("console", (message) => {
            if (message.type() === "error" && message.text().includes("Maximum update depth")) {
                const item = { type: "console", message: clean(message.text()), checkName: currentCheckName, url: p.url() };
                if (p.__preparationErrors) p.__preparationErrors.push(item);
                else runtimeErrors.push(item);
            }
        });
        p.on("response", (response) => {
            const url = response.url();
            const isScript = response.request().resourceType() === "script";
            if (!isScript || !(/\.js(?:[?#]|$)/i.test(url) || /\/_next\//i.test(url))) return;
            const headers = response.headers();
            const contentType = headers["content-type"] || "";
            const status = response.status();
            if (status < 400 && /(?:java|ecma)script/i.test(contentType)) return;
            runtimeErrors.push({ type: "badscript", url, status, contentType, checkName: currentCheckName });
        });
    });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(20000);
    const ready = await run("准备：登录或免登录并自建测试画布", prepareWithRetries);
    if (ready) {
        for (const [name, action] of checks) await run(name, action, true);
    } else {
        for (const [name] of checks)
            await run(name, async () => {
                throw new Error("测试画布准备失败，未执行");
            });
    }
} catch (error) {
    await run("Chrome 启动/运行环境", async () => {
        throw new Error(!browser ? `本机 Chrome 启动失败；${/SIGABRT|EPERM/.test(String(error)) ? "SIGABRT/EPERM（执行环境限制）" : clean(error.message)}` : clean(error.message));
    });
} finally {
    if (createdProjects.length && page && !page.isClosed()) await run("清理：删除本次测试画布", deleteProject);
    else if (createdProjects.length)
        await run("清理：删除本次测试画布", async () => {
            remainingProjectIds.push(...createdProjects.map((project) => project.id));
            throw new Error(`浏览器不可用，需手动删除测试画布 ${remainingProjectIds.join("、")}`);
        });
    await run("全程页面错误监听", async () => {
        if (!navigationStarted) throw new Skip("Chrome 未启动，页面检查未执行");
        const errors = runtimeErrors.filter((error) => error.type !== "badscript");
        assert.equal(errors.length, 0, errors.map((e) => `${e.type}: ${e.message}`).join("；"));
    });
    try {
        await browser?.close();
    } catch (error) {
        await run("关闭浏览器", async () => {
            throw error;
        });
    }
    const summary = {
        passed: results.filter((r) => r.status === "passed").length,
        failed: results.filter((r) => r.status === "failed").length,
        skipped: results.filter((r) => r.status === "skipped").length,
    };
    await writeFile(`${screens}report.json`, JSON.stringify({ baseURL, summary, results, runtimeErrors, panelSamples, remainingProjectId: remainingProjectIds.at(-1) || projectId, remainingProjectIds }, null, 2));
    console.log(`汇总：${summary.passed} 通过，${summary.failed} 失败，${summary.skipped} 跳过；截图/报告：e2e/screens/`);
    process.exitCode = summary.failed ? 1 : 0;
}
mockServers.forEach((server) => server.close());
