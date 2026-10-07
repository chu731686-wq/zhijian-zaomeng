"use client";

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { App } from "antd";

import { fetchUserConfig } from "@/services/api/user-config";
import { replaceWorkflowChannels } from "@/services/workflow-channel-storage";
import { STORAGE_SYNC_FAILED_EVENT, defaultUserStorageProvider, defaultUserWebDAVStorageProvider, saveUserStorageProvider, saveUserWebDAVStorageProvider } from "@/services/image-storage";
import { defaultConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { isPublicAuthPage } from "@/lib/auth-routes";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const pathname = usePathname();
    const router = useRouter();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const channelMode = useConfigStore((state) => state.config.channelMode);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isPublicPage = isPublicAuthPage(pathname);
    const authenticated = Boolean(token && user && user.role !== "guest");
    const isTokenDanceCallback = pathname === "/tokendance/callback";
    const adminRemoteTokenRef = useRef("");
    const accountSessionRef = useRef({ token, userId: user?.id || "" });

    useEffect(() => {
        const onSyncFailed = (event: Event) => {
            const detail = (event as CustomEvent<string>).detail;
            message.warning({ key: STORAGE_SYNC_FAILED_EVENT, content: `云端同步失败，已保留原始素材${detail ? `：${detail}` : ""}` });
        };
        window.addEventListener(STORAGE_SYNC_FAILED_EVENT, onSyncFailed);
        return () => window.removeEventListener(STORAGE_SYNC_FAILED_EVENT, onSyncFailed);
    }, [message]);

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        void hydrateUser();
    }, [hydrateUser]);

    useEffect(() => {
        if (!isReady || isPublicPage || authenticated) return;
        const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        router.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
    }, [authenticated, isPublicPage, isReady, pathname, router]);

	useEffect(() => {
		if (!token || adminRemoteTokenRef.current === token) return;
		if (isTokenDanceCallback) {
			adminRemoteTokenRef.current = token;
			return;
		}
		if (user?.role !== "admin") return;
		adminRemoteTokenRef.current = token;
		if (channelMode !== "remote") updateConfig("channelMode", "remote");
	}, [channelMode, isTokenDanceCallback, token, updateConfig, user?.role]);

	useLayoutEffect(() => {
		const previous = accountSessionRef.current;
		const userId = user?.id || "";
		if ((previous.token && !token) || (previous.userId && userId && previous.userId !== userId)) {
			useConfigStore.setState({ config: defaultConfig });
		} else {
			updateConfig("workflowSyncTouched", false);
		}
		accountSessionRef.current = { token, userId };
	}, [token, updateConfig, user?.id]);

	useEffect(() => {
        if (isTokenDanceCallback || !token || !user?.id) return;
        const accountToken = token;
        const accountId = user.id;
        let canceled = false;
		void fetchUserConfig(accountToken)
			.then(async (payload) => {
				if (canceled || useUserStore.getState().token !== accountToken || useUserStore.getState().user?.id !== accountId) return;
				let workflowsReady = true;
				const syncS3 = payload.modelConfig?.syncStorageConfig === true;
                const syncWebDAV = payload.modelConfig?.syncWebDAVStorageConfig === true;
                if (payload.modelConfig) {
                    const { workflowChannels, ...modelConfig } = payload.modelConfig;
					if (workflowChannels !== undefined) {
						try {
							await replaceWorkflowChannels(accountId, workflowChannels);
						} catch {
							workflowsReady = false;
						}
					}
                    if (canceled || useUserStore.getState().token !== accountToken || useUserStore.getState().user?.id !== accountId) return;
					Object.entries(modelConfig)
						.forEach(([key, value]) => updateConfig(key as keyof AiConfig, value as never));
				}
				updateConfig("workflowSyncTouched", workflowsReady);
				updateConfig("syncStorageConfig", syncS3);
                updateConfig("syncWebDAVStorageConfig", syncWebDAV);
                if (syncS3 && payload.storageProvider?.s3) {
                    saveUserStorageProvider({
                        ...defaultUserStorageProvider(),
                        ...payload.storageProvider.s3,
                        type: "s3",
                    });
                }
                if (syncWebDAV && payload.storageProvider?.webdav) {
                    saveUserWebDAVStorageProvider({
                        ...defaultUserWebDAVStorageProvider(),
                        ...payload.storageProvider.webdav,
                        type: "webdav",
                    });
                }
            })
            .catch(() => {});
        return () => {
            canceled = true;
        };
    }, [isTokenDanceCallback, token, updateConfig, user?.id]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        if (!publicSettings) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        if (!publicSettings.modelChannel.allowCustomChannel) {
            openConfigDialog(false);
            message.error("后台未允许用户自定义渠道，请联系管理员进行配置");
            return;
        }
        updateConfig("channelMode", "local");
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
    }, [message, openConfigDialog, publicSettings, updateConfig]);

    if (!isPublicPage && (!isReady || !authenticated)) return null;
    return <>{children}</>;
}
