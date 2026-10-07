"use client";

import Link from "next/link";
import { Copy, Ellipsis, Play, Trash2 } from "lucide-react";
import { CanvasNode } from "../components/canvas-node";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import styles from "../components/canvas-studio.module.css";

const samples: { label: string; node: CanvasNodeData; selected?: boolean; unavailable?: boolean }[] = [
    { label: "默认 · 文本预览", node: { id: "default", type: CanvasNodeType.Text, title: "雨夜的第一幕", position: { x: 0, y: 0 }, width: 248, height: 300, metadata: { status: "idle", content: `雨落在旧城的屋檐上。
少女推开门，发现桌上多了一封信。
远处的钟声响了三次。
她抬头，看见一盏仍亮着的灯。`, model: "文字模型", size: "3 场戏" } } },
    { label: "悬停 · 竖图完整显示", node: { id: "hover", type: CanvasNodeType.Image, title: "角色定妆", position: { x: 0, y: 0 }, width: 248, height: 300, metadata: { status: "success", content: "/samples/template-mystery.png", size: "2:3", quality: "高清" } } },
    { label: "选中 · 横图完整显示", selected: true, node: { id: "selected", type: CanvasNodeType.Image, title: "开场分镜", position: { x: 0, y: 0 }, width: 248, height: 300, metadata: { status: "success", content: "/samples/home-hero.png", size: "3:2", quality: "高清" } } },
    { label: "生成中 · 进度与文字", node: { id: "running", type: CanvasNodeType.Video, title: "生成开场视频", position: { x: 0, y: 0 }, width: 248, height: 300, metadata: { status: "loading", progress: 34, startedAt: 0, size: "16:9", seconds: "5", vquality: "1080p" } } },
    { label: "出错 · 原因与重试", node: { id: "error", type: CanvasNodeType.Audio, title: "雨夜旁白", position: { x: 0, y: 0 }, width: 248, height: 300, metadata: { status: "error", errorDetails: "模型连接失败，请检查接口配置", audioFormat: "MP3" } } },
    { label: "未接入 · 方图与设置入口", unavailable: true, node: { id: "unavailable", type: CanvasNodeType.Image, title: "品牌参考图", position: { x: 0, y: 0 }, width: 248, height: 300, metadata: { content: "/brand/mark.png", status: "idle", size: "1:1" } } },
];
const noop = () => {};

export default function CanvasStylePreview() {
    return <main className={`${styles.workspace} h-full overflow-auto bg-bg text-text`}>
        <header className={styles.topbar}><Link href="/" className="studio-icon-button" aria-label="回首页"><img src="/brand/mark.svg" width={28} height={28} alt="" /></Link><h1 className="text-sm font-semibold">画布外观样板</h1><Link href="/canvas" className="studio-text-link ml-auto">打开我的项目</Link></header>
        <div className="mx-auto max-w-[1000px] p-8">
            <p className="mb-8 text-sm text-muted-text">六种节点状态 · 移到卡片上查看悬停边框 · 图片按原比例完整显示</p>
            <div className="grid grid-cols-[repeat(auto-fit,248px)] justify-center gap-x-12 gap-y-8">
                {samples.map(({ label, node, selected, unavailable }) => <section key={node.id}>
                    <h2 className="mb-12 text-xs text-muted-text">{label}</h2>
                    <div className="relative h-[300px] w-[248px]">
                        {selected ? <div className="absolute -top-[52px] left-1/2 flex h-11 -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-surface px-2 text-xs text-muted-text">{[{ Icon: Play, title: "运行" }, { Icon: Copy, title: "复制" }, { Icon: Trash2, title: "删除" }, { Icon: Ellipsis, title: "更多" }].map(({ Icon, title }) => <button key={title} type="button" disabled className="flex min-h-9 items-center gap-1" aria-label={title}><Icon size={16} />{title}</button>)}</div> : null}
                        <CanvasNode data={node} scale={1} isSelected={Boolean(selected)} isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={false} showPanel={false} showImageInfo={false} modelUnavailable={Boolean(unavailable)} now={12000} onMouseDown={noop} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop} onResize={noop} onContentChange={noop} onTitleChange={noop} onContextMenu={noop} />
                    </div>
                </section>)}
            </div>
        </div>
    </main>;
}
