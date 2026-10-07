"use client";

import { useEffect, useState } from "react";
import { Button, Input, Tooltip, Typography } from "antd";
import { Copy, KeyRound, Link2, MessageSquare, PlugZap } from "lucide-react";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { useCodexAgent } from "../agent/use-codex-agent";

const startCommand = "node app/canvas-agent/index.mjs";

export function CanvasCliConnectView({ agent, onChat, cliOnly = false }: {
    agent: Pick<ReturnType<typeof useCodexAgent>, "connection" | "status" | "error" | "connect" | "disconnect">;
    onChat: () => void;
    cliOnly?: boolean;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const copyText = useCopyText();
    const [draft, setDraft] = useState(agent.connection);
    const connected = agent.status === "ready";
    const connecting = agent.status === "connecting";
    const statusText = { idle: "未连接", connecting: "连接中", ready: "已连接", error: "连接失败" }[agent.status];
    useEffect(() => setDraft(agent.connection), [agent.connection.endpoint, agent.connection.token]);
    const commandBlock = (command: string, label?: string) => (
        <div className="flex items-center gap-2 rounded-md border px-2.5 py-2" style={{ borderColor: theme.node.stroke }}>
            {label ? <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{label}</span> : null}
            <code className="thin-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-pre text-[11px] leading-5">{command}</code>
            <Tooltip title="复制命令"><Button type="text" size="small" className="!size-6 !min-w-6 shrink-0" style={{ color: theme.node.muted }} icon={<Copy className="size-3.5" />} onClick={() => copyText(command, "命令已复制")} aria-label={label ? `复制${label}命令` : "复制命令"} /></Tooltip>
        </div>
    );
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-base font-semibold leading-6">连接命令行</h2>
                <p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>Claude Code 和 Codex CLI 都能操作当前画布。连接后保持此网页打开即可，助手面板可以收起。</p>
            </div>
            <div className="space-y-2 px-3 py-2.5">
                <h3 className="text-sm font-medium">1. 启动本项目的服务</h3>
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>在项目文件夹打开终端。首次先安装本地服务依赖，再启动服务并保持终端运行。</p>
                {commandBlock("npm install --prefix app/canvas-agent", "首次安装")}
                {commandBlock(startCommand, "启动服务")}
                <h3 className="pt-2 text-sm font-medium">2. 填写下方连接信息</h3>
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>粘贴终端的 Local URL 和 Connect token，点击连接。Token 只需填一次，会记在本机浏览器；不要把它放进网址或分享给别人。</p>
                <h3 className="pt-2 text-sm font-medium">3. 注册命令行，再用自然语言操作</h3>
                {commandBlock("bash scripts/canvas-cli-setup.sh", "打印注册命令")}
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>复制脚本打印的命令到终端执行，然后重开 Claude Code 或 Codex。对它说“帮我在画布上创建三个分镜节点并连线”。Claude Code 可用 /model 选择 Opus；出图、出视频使用画布已配置的模型与接口。</p>
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">网页连接</span>
                            <span role="status" className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: theme.node.stroke, color: connected ? theme.node.text : theme.node.muted }}><span className="size-1.5 rounded-full bg-current" />{statusText}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>自动使用本机浏览器已保存的连接信息，也可手动填写。</p>
                    </div>
                    <Button type={connected || connecting ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={async () => {
                        if (connected || connecting) agent.disconnect();
                        else await agent.connect(draft);
                    }}>{connected || connecting ? "断开" : "连接"}</Button>
                </div>
                <div className="mt-3 grid gap-3">
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}><Link2 className="size-3.5" />本地地址 <span className="opacity-70">Local URL</span></span>
                        <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} aria-label="本地 Agent 地址" value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} placeholder="http://127.0.0.1:3210" />
                    </label>
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}><KeyRound className="size-3.5" />连接 Token <span className="opacity-70">Connect token</span></span>
                        <Input.Password size="large" prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />} aria-label="连接 Token" value={draft.token} onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))} placeholder="粘贴终端中的 Connect token" />
                    </label>
                    {agent.error ? <Typography.Text type="danger" role="alert" className="!text-xs leading-5">{agent.error}</Typography.Text> : null}
                    {connected ? <Button type="primary" icon={<MessageSquare className="size-4" />} onClick={onChat}>{cliOnly ? "完成" : "进入 Codex 对话"}</Button> : null}
                </div>
            </div>
        </div>
    );
}
