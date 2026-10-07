"use client";

import { App, Button, Result, Spin } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { TokenDanceOAuthState } from "@/lib/tokendance-oauth";
import { fetchUserConfig, syncUserModelConfig } from "@/services/api/user-config";
import { normalizeLocalChannels, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export default function TokenDanceCallbackPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const started = useRef(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        void (async () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const code = params.get("code");
                const flow = params.get("flow");
                const storageKey = flow ? `tokendance:oauth:${flow}` : "";
                const raw = storageKey ? sessionStorage.getItem(storageKey) : null;

                if (!code || !flow || !raw) throw new Error("授权信息已失效，请重新登录");

                const state = JSON.parse(raw) as TokenDanceOAuthState;
                if (!state.verifier || (state.target !== "local" && state.target !== "admin")) {
                    throw new Error("授权信息不完整，请重新登录");
                }

                const returnTo = typeof state.returnTo === "string"
                    ? state.returnTo.replace(/[\t\n\r]/g, "")
                    : "/";
                const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.startsWith("/\\")
                    ? returnTo
                    : "/";

                const response = await fetch("https://tokendance.space/portal/api/v1/auth/keys", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        code,
                        code_verifier: state.verifier,
                        code_challenge_method: "S256",
                    }),
                });
                const data = await response.json().catch(() => ({})) as {
                    key?: string;
                    message?: string;
                    error?: string;
                };

                if (!response.ok || typeof data.key !== "string" || !data.key.trim()) {
                    throw new Error(data.message || data.error || "TokenDance 授权失败");
                }

                const key = data.key.trim();

                if (state.target === "admin") {
                    if (!state.draft || typeof state.draft !== "object") {
                        throw new Error("后台渠道信息不完整，请重新登录");
                    }

                    sessionStorage.setItem(`tokendance:oauth-result:${flow}`, JSON.stringify({
                        key,
                        draft: state.draft,
                        editingChannelIndex: state.editingChannelIndex,
                    }));
                    sessionStorage.removeItem(storageKey);

                    const returnUrl = new URL(safeReturnTo, window.location.origin);
                    returnUrl.searchParams.set("tokendance_oauth", flow);
                    router.replace(`${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
                    return;
                }

                if (!state.channelId) throw new Error("对应的 TokenDance 渠道不存在");

                const store = useConfigStore.getState();
                const channels = normalizeLocalChannels(store.config);
                const target = channels.find((channel) =>
                    channel.id === state.channelId && channel.protocol === "tokendance",
                );
                if (!target) throw new Error("对应的 TokenDance 渠道不存在");

                const nextChannels = channels.map((channel) =>
                    channel.id === state.channelId ? { ...channel, apiKey: key } : channel,
                );
                const nextConfig = {
                    ...store.config,
                    localChannels: nextChannels,
                    ...(channels[0]?.id === state.channelId ? { apiKey: key } : {}),
                };

                const accountToken = useUserStore.getState().token;
                if (accountToken) {
                    const remote = await fetchUserConfig(accountToken);
                    if (useUserStore.getState().token !== accountToken) {
                        throw new Error("登录状态已变化，请重新登录");
                    }
                    await syncUserModelConfig(accountToken, nextConfig, remote.modelConfig?.workflowChannels);
                }

                store.updateConfig("localChannels", nextChannels);
                if (channels[0]?.id === state.channelId) store.updateConfig("apiKey", key);

                sessionStorage.removeItem(storageKey);
                message.success("TokenDance 登录成功，API Key 已填入");
                store.openConfigDialog(false);
                router.replace(safeReturnTo);
            } catch (reason) {
                setError(reason instanceof Error ? reason.message : "TokenDance 授权失败");
            }
        })();
    }, [message, router]);

    return (
        <main className="flex h-full items-center justify-center p-6">
            {error ? (
                <Result
                    status="error"
                    title="TokenDance 授权失败"
                    subTitle={error}
                    extra={<Button href="/">返回首页</Button>}
                />
            ) : (
                <Spin size="large" tip="正在完成 TokenDance 授权……" />
            )}
        </main>
    );
}
