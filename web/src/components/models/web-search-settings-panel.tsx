"use client";

import { useEffect, useState } from "react";
import { App, Input } from "antd";
import { Check, Globe, LoaderCircle } from "lucide-react";
import { fetchWebSearchSettings, saveWebSearchSettings, testWebSearchSettings, type WebSearchSettings } from "@/services/api/web-search";
import { useUserStore } from "@/stores/use-user-store";

export function WebSearchSettingsPanel() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [settings, setSettings] = useState<Omit<WebSearchSettings, "provider">>({ apiKey: "", configured: false });
    const [key, setKey] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("未测试");
    useEffect(() => {
        let canceled = false;
        setReady(false);
        setKey(null);
        setSettings({ apiKey: "", configured: false });
        setStatus("未测试");
        setBusy(false);
        if (token) void fetchWebSearchSettings(token).then((value) => {
            if (!canceled) { setSettings(value); setReady(true); }
        }).catch((error: Error) => { if (!canceled) message.error(error.message); });
        return () => { canceled = true; };
    }, [token, message]);

    const submit = async (test: boolean) => {
        if (!token || !ready) return;
        const usesBocha = key === null ? settings.configured : key.trim() !== "";
        // Keep the API input vocabulary; the backend selects the provider by key.
        const input = { provider: usesBocha ? "bocha" as const : "bing" as const, ...(key !== null ? { apiKey: key } : {}) };
        setBusy(true);
        try {
            if (test) await testWebSearchSettings(token, input);
            else {
                const saved = await saveWebSearchSettings(token, input);
                if (useUserStore.getState().token !== token) return;
                setSettings(saved);
                setKey(null);
            }
            if (useUserStore.getState().token !== token) return;
            setStatus(test ? "已连通" : "未测试");
            message.success(test ? `${usesBocha ? "博查" : "联网搜索"}连接成功` : "联网搜索设置已保存");
        } catch (error) {
            if (useUserStore.getState().token !== token) return;
            const reason = error instanceof Error ? error.message : "操作失败";
            if (test) setStatus(`连接失败：${reason}`);
            message.error(reason);
        } finally { if (useUserStore.getState().token === token) setBusy(false); }
    };

    return <section className="studio-model-card mt-6" aria-label="联网搜索">
        <div className="studio-model-main">
            <div className="studio-model-title"><Globe size={18} /><h2>联网搜索</h2></div>
            <p className="studio-muted">默认使用头条搜索（必应兜底），免费、无需配置</p>
            <p className="studio-muted mt-2">画布助手开启“联网”后即可查热点、找同类小说。</p>
            <details className="mt-3">
                <summary className="studio-text-link cursor-pointer">高级（可选）</summary>
                <p className="studio-muted mt-2">填写并保存博查密钥后使用博查；清除密钥并保存后恢复头条搜索（必应兜底）。</p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm">博查 API Key<Input type="password" autoComplete="new-password" disabled={!ready || busy} value={key ?? ""} placeholder={settings.configured ? `已保存 ${settings.apiKey}，填写可替换` : "选填博查 API Key"} onChange={(event) => { setKey(event.target.value); setStatus("未测试"); }} /></label>
                    <button type="button" className="studio-button" disabled={!ready || busy} onClick={() => void submit(true)}>{busy ? <LoaderCircle className="studio-spin" /> : <Check />}测试</button>
                    <button type="button" className="studio-button is-primary" disabled={!ready || busy} onClick={() => void submit(false)}>保存</button>
                    {settings.configured && <button type="button" className="studio-text-link" disabled={!ready || busy} onClick={() => { setKey(""); setStatus("点击保存以清除密钥并恢复头条搜索（必应兜底）"); }}>清除密钥</button>}
                </div>
                <p className="studio-muted mt-2" role="status">{!token ? "请先登录后保存可选的博查设置" : !ready ? "正在加载联网搜索设置…" : status}</p>
            </details>
        </div>
    </section>;
}
