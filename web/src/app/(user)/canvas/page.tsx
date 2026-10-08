"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { App, Avatar, Checkbox, Dropdown, Input, Modal, Select, Spin } from "antd";
import { Download, FileUp, FolderOpen, MoreHorizontal, Plus, Search, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useProjectPublishing, PublishedBadge } from "@/components/home/project-publishing";
import { readZip } from "@/lib/zip";
import { useCanvasStore, type CanvasProject } from "./stores/use-canvas-store";
import { ProjectThumbnail, projectSummary } from "@/components/home/home-projects";
import type { CanvasExportFile } from "./export-types";
import { exportCanvasProjects, restoreCanvasProject } from "./utils/canvas-export";
import { createTeam, getTeam, getTeams, type Team, type TeamDetail } from "@/services/api/team";
import { createTeamCanvasProject, deleteTeamCanvasProject, getCanvasAccess, listCanvasProjects, moveCanvasProjectToTeam, setCanvasAccess, type CanvasAccess, type TeamCanvas } from "@/services/api/canvas-tasks";
import { useUserStore } from "@/stores/use-user-store";

function updatedLabel(value: string) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
    return !Number.isFinite(minutes) ? "最近编辑" : minutes < 1 ? "刚刚更新" : minutes < 60 ? `${minutes} 分钟前更新` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前更新` : `${Math.floor(minutes / 1440)} 天前更新`;
}

export default function CanvasPage() {
    const { message, modal } = App.useApp();
    const router = useRouter();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState("all");
    const [teams, setTeams] = useState<Team[]>([]);
    const [remoteProjects, setRemoteProjects] = useState<TeamCanvas[]>([]);
    const [teamMembers, setTeamMembers] = useState<TeamDetail["members"]>([]);
    const [selectedTeam, setSelectedTeam] = useState("");
    const [movingProject, setMovingProject] = useState<TeamCanvas | null>(null);
    const [accessProject, setAccessProject] = useState<TeamCanvas | null>(null);
    const [access, setAccess] = useState<CanvasAccess>({ mode: "team", members: [] });
    const [loading, setLoading] = useState(false);
    const { publishedIds, publishingItems } = useProjectPublishing();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const localProjects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const refresh = () => {
        if (!token) return;
        setLoading(true);
        void Promise.all([getTeams(token), listCanvasProjects(token)]).then(([nextTeams, projects]) => { setTeams(nextTeams); setRemoteProjects(projects as TeamCanvas[]); }).catch((error) => message.error(error.message)).finally(() => setLoading(false));
    };
    useEffect(() => { refresh(); }, [token]);
    const projects = useMemo(() => {
        const byId = new Map<string, TeamCanvas>();
        localProjects.forEach((project) => byId.set(project.id, project as TeamCanvas));
        remoteProjects.forEach((project) => byId.set(project.id, project));
        return [...byId.values()];
    }, [localProjects, remoteProjects]);
    const visible = useMemo(() => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).filter((p) => {
        const matchesTab = tab === "all" || tab === "mine" ? (tab === "all" || !p.team_id) : p.team_id === tab;
        return matchesTab && p.title.toLowerCase().includes(query.trim().toLowerCase());
    }), [projects, query, tab]);
    const openProject = (id: string) => router.push(`/canvas/${id}`);
    const createAndEnter = async (teamId = selectedTeam) => {
        if (teamId && token) {
            const id = createProject(`无限画布 ${projects.length + 1}`, { teamId });
            const project = useCanvasStore.getState().projects.find((item) => item.id === id);
            if (!project) return;
            try {
                const saved = await createTeamCanvasProject(token, project, teamId);
                useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === id ? { ...saved, team_id: teamId } : item) }));
                message.success("已创建团队画布"); refresh(); openProject(id);
            }
            catch (error) { useCanvasStore.setState((state) => ({ projects: state.projects.filter((item) => item.id !== id) })); message.error(error instanceof Error ? error.message : "创建失败"); }
            return;
        }
        openProject(createProject(`无限画布 ${projects.length + 1}`));
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            const restored = await Promise.all(data.projects.map((item) => restoreCanvasProject(item.project, item.files, zip)));
            restored.forEach(importProject);
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch { message.error("导入失败，请选择有效的画布压缩包"); }
        finally { if (inputRef.current) inputRef.current.value = ""; }
    };
    const remove = (project: TeamCanvas) => modal.confirm({ title: `删除「${project.title}」？`, content: `确认后将只删除「${project.title}」及其画布内容。`, okText: "确认删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: async () => {
        try { if (project.team_id && token) await deleteTeamCanvasProject(token, project.id); else deleteProjects([project.id]); setRemoteProjects((items) => items.filter((item) => item.id !== project.id)); message.success("已删除"); }
        catch (error) { message.error(error instanceof Error ? error.message : "删除失败"); }
    } });
    const openAccess = async (project: TeamCanvas) => {
        if (!token || !project.team_id) return;
        try { const [current, detail] = await Promise.all([getCanvasAccess(token, project.id), getTeam(token, project.team_id)]); setAccess(current); setTeamMembers(detail.members); setAccessProject(project); }
        catch (error) { message.error(error instanceof Error ? error.message : "权限读取失败"); }
    };
    const saveAccess = async () => {
        if (!token || !accessProject) return;
        try { await setCanvasAccess(token, accessProject.id, access); setAccessProject(null); message.success("权限已保存"); refresh(); }
        catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
    };
    const moveToTeam = async () => {
        if (!token || !movingProject || !selectedTeam) return;
        const original = useCanvasStore.getState().projects.find((item) => item.id === movingProject.id);
        useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === movingProject.id ? { ...item, team_id: selectedTeam, team_name: teams.find((team) => team.id === selectedTeam)?.name } : item) }));
        try { await moveCanvasProjectToTeam(token, movingProject.id, selectedTeam); setMovingProject(null); setSelectedTeam(""); message.success("已移到团队"); refresh(); }
        catch (error) {
            if (original) useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === original.id ? original : item) }));
            message.error(error instanceof Error ? error.message : "移动失败");
        }
    };
    const newTeam = async () => {
        const name = window.prompt("团队名称");
        if (!name?.trim() || !token) return;
        try { const created = await createTeam(token, name.trim()); refresh(); setSelectedTeam(created.id); }
        catch (error) { message.error(error instanceof Error ? error.message : "创建团队失败"); }
    };
    const tabItems = [{ key: "all", label: "全部" }, { key: "mine", label: "我的" }, ...teams.map((team) => ({ key: team.id, label: team.name }))];

    return <main className="home-page studio-list-page"><div className="home-content">
                <header className="studio-page-heading"><div><p className="home-eyebrow">画布库</p><h1>我的项目</h1></div><div className="studio-page-actions"><label className="studio-search studio-inline-search"><Search /><Input aria-label="搜索项目" placeholder="搜索项目名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" className="studio-button" disabled={!hydrated} onClick={() => inputRef.current?.click()}><FileUp />导入画布</button><Dropdown trigger={["click"]} menu={{ items: [{ key: "personal", label: "个人项目", onClick: () => void createAndEnter("") }, ...teams.map((team) => ({ key: team.id, label: `放入「${team.name}」`, onClick: () => void createAndEnter(team.id) })), { type: "divider" }, { key: "create-team", label: "新建团队…", onClick: () => void newTeam() }] }}><button type="button" className="studio-button is-primary" disabled={!hydrated}><Plus />新建项目</button></Dropdown></div></header>
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="项目范围">{tabItems.map((item) => <button type="button" key={item.key} onClick={() => setTab(item.key)} className={`rounded-pill border px-4 py-2 text-sm transition ${tab === item.key ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted-text hover:bg-hover"}`}>{item.label}</button>)}</nav>
        {(!hydrated || loading) ? <div className="studio-empty-state"><Spin /></div> : visible.length ? <div className="studio-project-grid">{visible.map((project, index) => {
            const summary = projectSummary(project);
            const ownerOfProject = !project.team_id || project.userId === user?.id;
            const items = [
                ...publishingItems(project as CanvasProject),
                { key: "open", label: "打开项目", onClick: () => openProject(project.id) },
                { key: "export", label: "导出项目", icon: <Download size={16} />, onClick: () => void exportCanvasProjects([project as CanvasProject], project.title) },
                ...(!project.team_id ? [{ key: "move", label: "移到团队", icon: <Users size={16} />, onClick: () => setMovingProject(project) }] : []),
                ...(project.team_id && project.can_manage_access ? [{ key: "access", label: "权限设置", onClick: () => void openAccess(project) }] : []),
                ...(ownerOfProject || (project.team_id && project.can_manage_access) ? [{ key: "delete", label: "删除项目", danger: true, icon: <Trash2 size={16} />, onClick: () => remove(project) }] : []),
            ];
            return <article className="studio-project-card relative" key={project.id}>
                {publishedIds.has(project.id) && <PublishedBadge />}
                <button type="button" className="studio-project-preview" aria-label={`打开${project.title}`} onClick={() => openProject(project.id)}><ProjectThumbnail project={project as CanvasProject} index={index} /></button>
                <div className="studio-project-card-info"><div className="min-w-0 flex-1"><button type="button" className="studio-project-title" onClick={() => openProject(project.id)}>{project.title}</button>{project.team_name && <span className="ml-2 inline-flex items-center gap-1 rounded-pill border border-line bg-surface px-2 py-1 text-xs text-muted-text"><Users size={12} />{project.team_name}</span>}<p>{summary.detail} <span>·</span> {updatedLabel(project.updatedAt)}</p></div>
                    <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items }}><button type="button" className="studio-icon-button" aria-label={`${project.title}更多操作`}><MoreHorizontal /></button></Dropdown>
                </div>
            </article>;
        })}</div> : <section className="studio-empty-state"><div className="studio-empty-icon"><FolderOpen /></div><h2>{query ? "没有找到项目" : "还没有项目"}</h2><p>{query ? "试试其他关键词" : "新建一个项目，开始你的漫剧创作"}</p><button type="button" className="studio-button is-primary" onClick={() => void createAndEnter()}><Plus />新建项目</button></section>}
        <input ref={inputRef} type="file" accept="application/zip,.zip" hidden onChange={(event) => void importCanvas(event.target.files?.[0])} />
        <Modal title="移到团队" open={Boolean(movingProject)} okText="移动" cancelText="取消" onCancel={() => setMovingProject(null)} onOk={() => void moveToTeam()} okButtonProps={{ disabled: !selectedTeam }}>{teams.length ? <Select className="w-full" placeholder="选择团队" value={selectedTeam || undefined} onChange={setSelectedTeam} options={teams.map((team) => ({ value: team.id, label: team.name }))} /> : <p className="text-muted-text">你还没有加入团队</p>}</Modal>
        <Modal title="画布权限设置" open={Boolean(accessProject)} okText="保存" cancelText="取消" onCancel={() => setAccessProject(null)} onOk={() => void saveAccess()}>
            <Select className="mb-4 w-full" value={access.mode} onChange={(mode: CanvasAccess["mode"]) => setAccess({ ...access, mode })} options={[{ value: "team", label: "跟随团队身份" }, { value: "custom", label: "只给指定的人" }]} />
            {access.mode === "custom" && <><div className="max-h-72 space-y-3 overflow-auto">{teamMembers.filter((member) => member.role !== "owner" && member.role !== "admin" && member.user_id !== accessProject?.userId).map((member) => {
                const selected = access.members.find((entry) => entry.user_id === member.user_id);
                const roleLabel = member.role === "viewer" ? "只能看" : member.role === "editor" ? "可编辑" : member.role === "admin" ? "管理员" : "队长";
                return <div key={member.user_id} className="flex flex-wrap items-center gap-3"><Avatar size="small" src={member.avatar || undefined}>{member.name?.slice(0, 1)}</Avatar><div className="min-w-24 flex-1"><span>{member.name}</span><span className="ml-2 text-xs text-muted-text">{roleLabel}</span></div><Checkbox checked={Boolean(selected)} onChange={(event) => setAccess({ ...access, members: event.target.checked ? [...access.members, { user_id: member.user_id, permission: "view" }] : access.members.filter((entry) => entry.user_id !== member.user_id) })}>允许访问</Checkbox>{selected && <Select size="small" value={member.role === "viewer" ? "view" : selected.permission} disabled={member.role === "viewer"} onChange={(permission: "edit" | "view") => setAccess({ ...access, members: access.members.map((entry) => entry.user_id === member.user_id ? { ...entry, permission } : entry) })} options={member.role === "viewer" ? [{ value: "view", label: "只能看" }] : [{ value: "edit", label: "可编辑" }, { value: "view", label: "只能看" }]} />}</div>;
            })}</div><p className="mt-3 text-xs text-muted-text">队长、管理员和画布创建者始终可以访问。</p></>}
        </Modal>
    </div></main>;
}
