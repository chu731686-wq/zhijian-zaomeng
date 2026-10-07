import { Sparkles } from "lucide-react";

export default function SkillsPage() {
    return <main className="home-page studio-list-page"><div className="home-content">
        <header className="studio-page-heading"><div><p className="home-eyebrow">创作工具</p><h1>漫剧助手 · 技能</h1><p className="studio-muted">为剧本、角色、分镜与成片制作提供专属创作能力。</p></div></header>
        <section className="studio-empty-state"><div className="studio-empty-icon"><Sparkles /></div><h2>技能即将上线</h2><p>漫剧创作技能正在准备中，稍后即可在这里查看和使用。</p></section>
    </div></main>;
}
