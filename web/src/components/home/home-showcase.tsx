"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { useShowcaseStore } from "@/stores/use-showcase-store";
import { useUserStore } from "@/stores/use-user-store";
import { imagePreviewUrl } from "@/services/image-storage";

export function HomeShowcase({ query = "" }: { query?: string }) {
    const token = useUserStore((state) => state.token);
    const { items, loading, error, refresh } = useShowcaseStore();
    useEffect(() => { void refresh(); }, [token, refresh]);
    const visible = items.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));
    return <section className="mt-8" aria-labelledby="showcase-title">
        <div className="studio-section-header"><h2 id="showcase-title">作品展示</h2><span className="studio-muted">管理员作品 · 只读查看</span></div>
        {!token ? <p className="studio-muted">登录后即可查看作品展示</p> : error ? <p role="alert" className="studio-muted">{error} <button className="studio-text-link" onClick={() => void refresh()}>重试</button></p> : loading && !items.length ? <p className="studio-muted">正在加载作品…</p> : !visible.length ? <p className="studio-muted">{query ? "没有找到相关作品" : "暂无展示作品"}</p> : <div className="studio-project-grid">
            {visible.map((item) => <Link key={item.id} href={`/showcase/${encodeURIComponent(item.id)}`} className="studio-project-card">
                <div className="studio-project-preview">{item.coverFileId ? <img src={imagePreviewUrl(`/api/files/${encodeURIComponent(item.coverFileId)}/content`)} alt={`${item.title}封面`} loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon className="m-auto size-10 text-muted-text" />}</div>
                <div className="studio-project-card-info"><strong className="studio-project-title">{item.title}</strong><p>作者 {item.ownerName} · {item.nodeCount} 个节点</p><time className="studio-muted" dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString("zh-CN")}</time></div>
            </Link>)}
        </div>}
    </section>;
}
