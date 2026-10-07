"use client";

import { useRouter } from "next/navigation";
import { useCanvasStore } from "../canvas/stores/use-canvas-store";
import { HomeTemplates } from "@/components/home/home-templates";

export default function TemplatesPage() {
    const router = useRouter();
    const createProject = useCanvasStore((state) => state.createProject);
    const useTemplate = (prompt: string) => {
        const id = createProject("新漫剧", { pendingAgentRequest: { prompt, assets: [], skills: [] } });
        router.push(`/canvas/${id}`);
    };
    return <main className="home-page studio-list-page"><div className="home-content">
        <header className="studio-page-heading"><div><p className="home-eyebrow">灵感广场</p><h1>灵感广场 · 模板</h1><p className="studio-muted">从一个故事灵感开始，开启你的漫剧创作。</p></div></header>
        <HomeTemplates onUse={useTemplate} />
        <section className="studio-coming-soon"><span className="studio-coming-mark">＋</span><div><h2>更多模板即将上线</h2><p>新的题材灵感正在准备中，敬请期待。</p></div></section>
    </div></main>;
}
