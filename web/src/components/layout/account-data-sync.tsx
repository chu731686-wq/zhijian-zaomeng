"use client";

import { useEffect, useRef, useState } from "react";
import { App, Modal, Progress } from "antd";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { localForageStorage } from "@/lib/localforage-storage";
import { ACCOUNT_IMPORT_EVENT, ACCOUNT_SYNC_FAILED_EVENT, accountScope, reportAccountSyncFailure } from "@/services/account-storage";
import { findLocalAccountImport, importLocalAccountData, type LocalAccountImport } from "@/services/account-import";
import { clearFileSession } from "@/services/api/file-session";

function waitForStores() {
    return Promise.all([useCanvasStore, useAssetStore].map((store) => {
        if (store.persist.hasHydrated()) return Promise.resolve();
        return new Promise<void>((resolve) => {
            const off = store.persist.onFinishHydration(() => { off(); resolve(); });
            if (store.persist.hasHydrated()) { off(); resolve(); }
        });
    }));
}

export function AccountDataSync() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const ready = useUserStore((state) => state.isReady);
    const [pending, setPending] = useState<LocalAccountImport | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const importing = useRef(false);
    const promptKey = (value: string) => `infinite-canvas:import-prompted:${accountScope(value)}`;

    useEffect(() => {
        if (!ready) return;
        let canceled = false;
        setPending(null);
        setProgress(null);
        const sync = async () => {
            await waitForStores();
            if (canceled || useUserStore.getState().token !== token) return;
            if (!token) void clearFileSession().catch(reportAccountSyncFailure);
            await Promise.all([
                useCanvasStore.getState().syncWithRemote(token, Boolean(token)),
                useAssetStore.getState().hydrateAccountAssets(token, Boolean(token)),
            ]);
            if (canceled || useUserStore.getState().token !== token) return;
            if (token && !(await localForageStorage.getItem(promptKey(token)))) {
                const local = await findLocalAccountImport(token);
                if (canceled) return;
                if (local.projects.length || local.assets.length) setPending(local);
                else await localForageStorage.setItem(promptKey(token), "true");
            }
        };
        void sync().catch(reportAccountSyncFailure);
        const retry = () => { if (!importing.current) void sync().catch(reportAccountSyncFailure); };
        const openImport = () => {
            if (!token || importing.current) return;
            void findLocalAccountImport(token).then((local) => {
                if (canceled) return;
                if (local.projects.length || local.assets.length) setPending(local);
                else message.info("本机画布和素材已在你的账号中");
            }).catch(reportAccountSyncFailure);
        };
        window.addEventListener("online", retry);
        window.addEventListener(ACCOUNT_IMPORT_EVENT, openImport);
        return () => {
            canceled = true;
            window.removeEventListener("online", retry);
            window.removeEventListener(ACCOUNT_IMPORT_EVENT, openImport);
        };
    }, [ready, token, message]);

    useEffect(() => {
        const failed = (event: Event) => {
            message.warning({ key: ACCOUNT_SYNC_FAILED_EVENT, content: `账号同步失败，本机数据已保留：${(event as CustomEvent<string>).detail}。联网后自动重试，也可刷新页面重试。`, duration: 8 });
        };
        window.addEventListener(ACCOUNT_SYNC_FAILED_EVENT, failed);
        return () => window.removeEventListener(ACCOUNT_SYNC_FAILED_EVENT, failed);
    }, [message]);

    const defer = async () => {
        await localForageStorage.setItem(promptKey(token), "true");
        setPending(null);
    };
    const upload = async () => {
        if (importing.current) return;
        importing.current = true;
        setProgress({ done: 0, total: (pending?.projects.length || 0) + (pending?.assets.length || 0) });
        try {
            await importLocalAccountData(token, (done, total) => {
                if (useUserStore.getState().token === token) setProgress({ done, total });
            });
            if (useUserStore.getState().token !== token) return;
            await defer();
            message.success("本机画布和素材已传到你的账号");
        } catch (error) {
            reportAccountSyncFailure(error);
        } finally {
            importing.current = false;
            setProgress(null);
        }
    };

    return <Modal open={Boolean(pending)} title={progress ? "正在上传本机数据" : pending ? `把本机的 ${pending.projects.length} 个画布、${pending.assets.length} 个素材传到你的账号？` : "上传本机数据"}
        okText="传" cancelText="先不传" onOk={upload} onCancel={defer} confirmLoading={Boolean(progress)}
        cancelButtonProps={{ disabled: Boolean(progress) }} closable={!progress} mask={{ closable: !progress }} keyboard={!progress}>
        <p>上传后可在其他电脑登录查看。本机原始数据会保留；同一条记录以最近修改为准。以后也可以从账户菜单选择“上传本机画布和素材”。</p>
        {progress && <><Progress percent={progress.total ? Math.round(progress.done / progress.total * 100) : 100} /><p aria-live="polite">已上传 {progress.done} / {progress.total} 条，媒体文件较大时请稍候。</p></>}
    </Modal>;
}
