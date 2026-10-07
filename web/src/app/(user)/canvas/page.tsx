"use client";

import { useMemo, useRef, useState } from "react";
import { App, Dropdown, Input } from "antd";
import { Download, FileUp, FolderOpen, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useProjectPublishing, PublishedBadge } from "@/components/home/project-publishing";
import { readZip } from "@/lib/zip";
import { useCanvasStore, type CanvasProject } from "./stores/use-canvas-store";
import { ProjectThumbnail, projectSummary } from "@/components/home/home-projects";
import type { CanvasExportFile } from "./export-types";
import { exportCanvasProjects, restoreCanvasProject } from "./utils/canvas-export";

function updatedLabel(value: string) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
    return !Number.isFinite(minutes) ? "最近编辑" : minutes < 1 ? "刚刚更新" : minutes < 60 ? `${minutes} 分钟前更新` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前更新` : `${Math.floor(minutes / 1440)} 天前更新`;
}

export default function CanvasPage() {
    const { message, modal } = App.useApp();
    const { publishedIds, publishingItems } = useProjectPublishing();
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const visible = useMemo(() => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase())), [projects, query]);
    const openProject = (id: string) => router.push(`/canvas/${id}`);
    const createAndEnter = () => openProject(createProject(`无限画布 ${projects.length + 1}`));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            const projects = await Promise.all(data.projects.map((item) => restoreCanvasProject(item.project, item.files, zip)));
            projects.forEach(importProject);
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            message.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };
    const remove = (project: CanvasProject) => modal.confirm({
        title: `删除「${project.title}」？`,
        content: `确认后将只删除「${project.title}」及其画布内容。`,
        okText: "确认删除", cancelText: "取消", okButtonProps: { danger: true },
        onOk: () => {
            const latest = useCanvasStore.getState().projects.find((item) => item.id === project.id);
            if (!latest) return;
            deleteProjects([latest.id]);
            message.success("已删除");
        },
    });

    return <main className="home-page studio-list-page"><div className="home-content">
        <header className="studio-page-heading">
            <div><p className="home-eyebrow">画布库</p><h1>我的项目</h1></div>
            <div className="studio-page-actions"><label className="studio-search studio-inline-search"><Search /><Input aria-label="搜索项目" placeholder="搜索项目名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
                <button type="button" className="studio-button" disabled={!hydrated} onClick={() => inputRef.current?.click()}><FileUp />导入画布</button>
                <button type="button" className="studio-button is-primary" disabled={!hydrated} onClick={createAndEnter}><Plus />新建项目</button></div>
        </header>
        {!hydrated ? <div className="studio-empty-state"><p>正在加载项目…</p></div> : visible.length ? <div className="studio-project-grid">{visible.map((project, index) => {
            const summary = projectSummary(project);
            return <article className="studio-project-card relative" key={project.id}>
                {publishedIds.has(project.id) && <PublishedBadge />}
                <button type="button" className="studio-project-preview" aria-label={`打开${project.title}`} onClick={() => openProject(project.id)}><ProjectThumbnail project={project} index={index} /></button>
                <div className="studio-project-card-info"><button type="button" className="studio-project-title" onClick={() => openProject(project.id)}>{project.title}</button>
                    <p>{summary.detail} <span>·</span> {updatedLabel(project.updatedAt)}</p>
                    <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: [
                        ...publishingItems(project),
                        { key: "open", label: "打开项目", onClick: () => openProject(project.id) },
                        { key: "export", label: "导出项目", icon: <Download size={16} />, onClick: () => void exportCanvasProjects([project], project.title) },
                        { key: "delete", label: "删除项目", danger: true, icon: <Trash2 size={16} />, onClick: () => remove(project) },
                    ] }}><button type="button" className="studio-icon-button" aria-label={`${project.title}更多操作`}><MoreHorizontal /></button></Dropdown>
                </div>
            </article>;
        })}</div> : <section className="studio-empty-state"><div className="studio-empty-icon"><FolderOpen /></div><h2>{query ? "没有找到项目" : "还没有项目"}</h2><p>{query ? "试试其他关键词" : "新建一个项目，开始你的漫剧创作"}</p><button type="button" className="studio-button is-primary" onClick={createAndEnter}><Plus />新建项目</button></section>}
        <input ref={inputRef} type="file" accept="application/zip,.zip" hidden onChange={(event) => void importCanvas(event.target.files?.[0])} />
    </div></main>;
}
