"use client";

import { App, Button, Table, type TableColumnsType } from "antd";
import { Copy, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { createAdminInvite, fetchAdminInvites, revokeAdminInvite, type RegistrationInvite } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export default function AdminInvitesPage() {
    const { message, modal } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [items, setItems] = useState<RegistrationInvite[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const refresh = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            setItems(await fetchAdminInvites(token));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "邀请码加载失败");
        } finally {
            setLoading(false);
        }
    }, [message, token]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const create = async () => {
        setCreating(true);
        try {
            const invite = await createAdminInvite(token);
            setItems((current) => [invite, ...current]);
            message.success("邀请码已生成，可复制后分享");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            setCreating(false);
        }
    };

    const revoke = (item: RegistrationInvite) => {
        modal.confirm({
            title: "作废邀请码？",
            content: `作废后 ${item.code} 将无法注册。`,
            okText: "作废",
            cancelText: "取消",
            onOk: async () => {
                try {
                    await revokeAdminInvite(token, item.code);
                    setItems((current) => current.map((row) => (row.code === item.code ? { ...row, revoked: true } : row)));
                    message.success("邀请码已作废");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "作废失败");
                    throw error;
                }
            },
        });
    };

    const columns: TableColumnsType<RegistrationInvite> = [
        { title: "邀请码", dataIndex: "code", width: 330, render: (code: string) => <span className="font-mono text-text">{code}</span> },
        { title: "状态", width: 100, render: (_, item) => <span className={item.usedBy ? "text-ok" : item.revoked ? "text-error" : "text-muted-text"}>{item.usedBy ? "已使用" : item.revoked ? "已作废" : "未使用"}</span> },
        { title: "使用账号 ID", dataIndex: "usedBy", render: (value: string) => value || "—" },
        { title: "生成时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString("zh-CN") },
        { title: "使用时间", dataIndex: "usedAt", render: (value: string) => (value ? new Date(value).toLocaleString("zh-CN") : "—") },
        {
            title: "操作",
            width: 160,
            render: (_, item) => (
                <div className="flex gap-2">
                    <Button
                        type="text"
                        disabled={!!item.usedBy || item.revoked}
                        icon={<Copy size={16} strokeWidth={1.75} />}
                        onClick={() =>
                            void navigator.clipboard
                                .writeText(item.code)
                                .then(() => message.success("已复制邀请码"))
                                .catch(() => message.error("复制失败，请选中邀请码手动复制"))
                        }
                    >
                        复制
                    </Button>
                    <Button type="text" disabled={!!item.usedBy || item.revoked} onClick={() => revoke(item)}>
                        作废
                    </Button>
                </div>
            ),
        },
    ];

    return (
        <main className="min-h-full bg-bg p-8 text-text">
            <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-page-title">邀请码</h1>
                    <p className="mt-2 text-body text-muted-text">每个邀请码只能注册一次，邮箱与 Google 注册共用。未使用的邀请码可作废。</p>
                </div>
                <div className="flex gap-3">
                    <Button icon={<RefreshCw size={16} strokeWidth={1.75} />} loading={loading} onClick={() => void refresh()}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus size={16} strokeWidth={1.75} />} loading={creating} onClick={() => void create()}>
                        生成邀请码
                    </Button>
                </div>
            </div>
            <div className="overflow-hidden rounded-card border border-line bg-surface p-4">
                <Table<RegistrationInvite> rowKey="code" columns={columns} dataSource={items} loading={loading} scroll={{ x: 1100 }} pagination={{ pageSize: 20 }} locale={{ emptyText: "还没有邀请码，点击右上角生成" }} />
            </div>
        </main>
    );
}
