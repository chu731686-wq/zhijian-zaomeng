"use client";

import { useEffect, useState } from "react";
import { App, Button, Input, Spin } from "antd";
import { Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { createTeam, getTeams, type Team } from "@/services/api/team";
import { useUserStore } from "@/stores/use-user-store";

export default function TeamPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const token = useUserStore((state) => state.token);
    const [teams, setTeams] = useState<Team[]>([]);
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const refresh = () => token && getTeams(token).then(setTeams).catch((error) => message.error(error.message)).finally(() => setLoading(false));
    useEffect(() => { refresh(); }, [token]);
    const addTeam = async () => {
        if (!token || !name.trim()) return;
        setSaving(true);
        try { const team = await createTeam(token, name.trim()); setName(""); router.push(`/team/${team.id}`); }
        catch (error) { message.error(error instanceof Error ? error.message : "创建失败"); }
        finally { setSaving(false); }
    };
    return <main className="home-page"><div className="home-content">
        <header className="studio-page-heading"><div><p className="home-eyebrow">协作空间</p><h1>团队</h1></div></header>
        <section className="mb-8 rounded-card border border-line bg-surface p-5">
            <h2 className="mb-3 text-section-title font-semibold">创建团队</h2>
            <div className="flex max-w-xl gap-3"><Input maxLength={40} placeholder="输入团队名称" value={name} onChange={(event) => setName(event.target.value)} onPressEnter={() => void addTeam()} /><Button type="primary" icon={<Plus size={16} />} loading={saving} disabled={!name.trim()} onClick={() => void addTeam()}>创建</Button></div>
        </section>
        <h2 className="mb-4 text-section-title font-semibold">我加入的团队</h2>
        {loading ? <div className="py-12 text-center"><Spin /></div> : teams.length ? <div className="studio-project-grid">{teams.map((team) => <button type="button" key={team.id} onClick={() => router.push(`/team/${team.id}`)} className="rounded-card border border-line bg-surface p-5 text-left transition hover:bg-hover"><div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"><Users /></div><h3 className="text-card-title font-semibold">{team.name}</h3><p className="mt-2 text-sm text-muted-text">{team.member_count} 位成员 · {team.role === "owner" ? "队长" : team.role === "admin" ? "管理员" : team.role === "viewer" ? "只能看" : "可编辑"}</p></button>)}</div> : <div className="studio-empty-state"><div className="studio-empty-icon"><Users /></div><h2>还没有加入团队</h2><p>创建一个团队，邀请伙伴一起创作</p></div>}
    </div></main>;
}
