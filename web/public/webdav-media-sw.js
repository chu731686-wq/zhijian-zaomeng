const configs = new Map();
const waiters = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
    if (event.data?.type !== "webdav-media-config") return;
    const id = String(event.data.id || "");
    configs.set(id, event.data.config);
    waiters.get(id)?.resolve(event.data.config);
});
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith("/webdav-media/")) return;
    event.respondWith(streamWebDAVMedia(event, url));
});

async function streamWebDAVMedia(event, url) {
    const parts = url.pathname.slice("/webdav-media/".length).split("/");
    const id = decodeURIComponent(parts.shift() || "");
    const objectKey = decodeURIComponent(parts.join("/"));
    const config = configs.get(id) || await requestConfig(event.clientId, id);
    if (!config || !objectKey) return new Response("WebDAV 配置不可用", { status: 503 });
    const headers = new Headers({ Authorization: config.authorization });
    const range = event.request.headers.get("Range");
    if (range) headers.set("Range", range);
    try {
        return await fetch(config.endpoint.replace(/\/+$/, "") + "/" + objectKey.split("/").map(encodeURIComponent).join("/"), {
            method: event.request.method,
            headers,
        });
    } catch {
        return new Response("WebDAV 连接失败", { status: 502 });
    }
}

async function requestConfig(clientId, id) {
    if (waiters.has(id)) return waiters.get(id).promise;
    const client = await self.clients.get(clientId);
    if (!client) return null;
    let resolveConfig;
    const promise = new Promise((resolve) => {
        const timeout = setTimeout(() => {
            waiters.delete(id);
            resolve(null);
        }, 3000);
        resolveConfig = (value) => {
            clearTimeout(timeout);
            waiters.delete(id);
            resolve(value);
        };
    });
    waiters.set(id, { promise, resolve: resolveConfig });
    client.postMessage({ type: "webdav-media-config-request", id });
    return promise;
}
