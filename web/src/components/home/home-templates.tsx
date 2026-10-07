"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

export const homeTemplates = [
    { id: "mystery", title: "古风悬疑", image: "/samples/template-mystery.png", tags: ["古风", "探案", "反转"], prompt: "创作一部古风悬疑漫剧：女探案人在雨夜古城追查一盏失踪的灯，揭开尘封旧案。请从剧本、角色、分镜到视频制定创作计划。" },
    { id: "romance", title: "都市情感", image: "/samples/template-romance.png", tags: ["都市", "情感", "成长"], prompt: "创作一部都市情感漫剧：独自在城市打拼的女孩，在雨夜咖啡馆收到一封来自过去的信。请从剧本、角色、分镜到视频制定创作计划。" },
    { id: "scifi", title: "科幻冒险", image: "/samples/template-scifi.png", tags: ["科幻", "冒险", "探索"], prompt: "创作一部科幻冒险漫剧：年轻探索者在废弃空间站发现来自陌生星球的信号。请从剧本、角色、分镜到视频制定创作计划。" },
] as const;

export function HomeTemplates({ query = "", onUse }: { query?: string; onUse: (prompt: string) => void }) {
    const templates = homeTemplates.filter((t) => `${t.title} ${t.tags.join(" ")}`.includes(query));
    return (
        <section aria-labelledby="templates-title">
            <div className="studio-section-header">
                <h2 id="templates-title">灵感模板</h2>
                <Link href="/templates" prefetch={false} className="studio-text-link">
                    查看全部
                    <ArrowRight />
                </Link>
            </div>
            <div className="home-template-grid">
                {templates.map((t) => (
                    <article key={t.id} className="home-template">
                        <img src={t.image} alt={`${t.title}原创漫剧海报`} loading="lazy" />
                        <div className="home-template-info">
                            <h3>{t.title}</h3>
                            <div className="home-template-tags">
                                {t.tags.map((tag) => (
                                    <span key={tag}>{tag}</span>
                                ))}
                            </div>
                            <p>
                                剧本 <span>›</span> 角色 <span>›</span> 分镜 <span>›</span> 视频
                            </p>
                        </div>
                        <button type="button" className="studio-button is-primary home-template-use" onClick={() => onUse(t.prompt)}>
                            使用模板
                            <ArrowRight />
                        </button>
                    </article>
                ))}
            </div>
            {!templates.length && <p className="studio-muted home-search-empty">没有找到相关模板，换个关键词试试</p>}
        </section>
    );
}
