"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { App, Dropdown, Input, Modal } from "antd";
import { ArrowRight, CheckCircle2, Circle, Copy, FolderOpen, LoaderCircle, MoreHorizontal, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { useCanvasStore, type CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import { CanvasNodeType } from "@/app/(user)/canvas/types";
import { resolveImageUrl } from "@/services/image-storage";

const sampleThumbnails = ["/samples/project-mystery.png", "/samples/project-romance.png", "/samples/project-scifi.png"];

export function projectSummary(project: CanvasProject) {
    const nodes = project.nodes.filter((n) => n.type !== CanvasNodeType.Group);
    const running = nodes.filter((n) => n.metadata?.status === "loading");
    const done = nodes.filter((n) => n.metadata?.status === "success");
    const error = nodes.some((n) => n.metadata?.status === "error");
    const status = running.length ? "running" : error ? "error" : nodes.length && done.length === nodes.length ? "ok" : "waiting";
    const progress = nodes.length ? Math.round(nodes.reduce((sum, n) => sum + (n.metadata?.status === "success" ? 100 : n.metadata?.status === "loading" ? Math.max(0, Math.min(100, n.metadata.progress || 0)) : 0), 0) / nodes.length) : 0;
    const shots = nodes.filter((n) => n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Video).length;
    return { status, progress, running, detail: `${nodes.length} 个节点 · ${shots} 个镜头`, label: status === "running" ? "生成中" : status === "error" ? "出错" : status === "ok" ? "已完成" : "草稿" };
}

export function ProjectThumbnail({ project, index = 0 }: { project: CanvasProject; index?: number }) {
    const image = project.nodes.find((n) => (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Panorama) && (n.metadata?.content || n.metadata?.storageKey));
    const [url, setUrl] = useState("");
    const content = image?.metadata?.content;
    const storageKey = image?.metadata?.storageKey;
    useEffect(() => {
        let active = true;
        setUrl("");
        if (image)
            void resolveImageUrl(storageKey, content || "")
                .then((value) => {
                    if (active) setUrl(value);
                })
                .catch(() => {});
        return () => {
            active = false;
        };
    }, [image?.id, content, storageKey]);
    const fallback = sampleThumbnails[index % sampleThumbnails.length];
    return (
        <span className={`home-project-thumbnail ${url ? "has-preview" : ""}`}>
            <img
                src={url || fallback}
                alt={url ? `${project.title}预览` : "示例封面"}
                loading="lazy"
                onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = fallback;
                }}
            />
            {!url && <small>示例封面</small>}
        </span>
    );
}

function updatedLabel(value: string) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
    if (!Number.isFinite(minutes)) return "最近编辑";
    return minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`;
}

export function HomeProjects({ projects, hydrated, query, onBlank }: { projects: CanvasProject[]; hydrated: boolean; query: string; onBlank: () => void }) {
    const { modal, message } = App.useApp();
    const [renaming, setRenaming] = useState<CanvasProject | null>(null);
    const [title, setTitle] = useState("");
    const renameProject = useCanvasStore((s) => s.renameProject);
    const importProject = useCanvasStore((s) => s.importProject);
    const deleteProjects = useCanvasStore((s) => s.deleteProjects);
    const remove = (project: CanvasProject) =>
        modal.confirm({
            title: `删除「${project.title}」？`,
            content: "只删除这个项目及其画布内容。删除后可通过提示中的撤销恢复。",
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => {
                // Read the latest version at confirmation, preserving any intervening changes.
                const snapshot = useCanvasStore.getState().openProject(project.id);
                if (!snapshot) return;
                deleteProjects([project.id]);
                let restored = false;
                const key = `deleted-${project.id}`;
                message.open({
                    key,
                    duration: 10,
                    content: (
                        <span>
                            已删除「{snapshot.title}」 ·{" "}
                            <button
                                type="button"
                                className="studio-undo"
                                onClick={() => {
                                    if (restored) return;
                                    restored = true;
                                    useCanvasStore.setState((s) => ({ projects: s.projects.some((p) => p.id === snapshot.id) ? s.projects : [snapshot, ...s.projects] }));
                                    message.destroy(key);
                                    message.success("项目已恢复");
                                }}
                            >
                                撤销
                            </button>
                        </span>
                    ),
                });
            },
        });
    return (
        <section aria-labelledby="projects-title">
            <div className="studio-section-header">
                <h2 id="projects-title">继续创作</h2>
                <Link href="/canvas" className="studio-text-link">
                    全部项目
                    <ArrowRight />
                </Link>
            </div>
            <div className="home-project-list">
                {!hydrated ? (
                    <div className="home-project-empty">
                        <LoaderCircle className="studio-spin" />
                        <p>正在加载项目…</p>
                    </div>
                ) : projects.length ? (
                    projects.slice(0, 3).map((project, index) => {
                        const summary = projectSummary(project);
                        const Icon = summary.status === "running" ? LoaderCircle : summary.status === "ok" ? CheckCircle2 : summary.status === "error" ? TriangleAlert : Circle;
                        return (
                            <article className="home-project-card" key={project.id}>
                                <Link href={`/canvas/${project.id}`} className="home-project-open">
                                    <ProjectThumbnail project={project} index={index} />
                                    <div className="home-project-info">
                                        <h3>{project.title}</h3>
                                        <p>{summary.detail}</p>
                                        <div className="home-project-meta">
                                            <span className={`studio-status is-${summary.status}`}>
                                                <Icon className={summary.status === "running" ? "studio-spin" : ""} />
                                                {summary.label}
                                            </span>
                                            <time dateTime={project.updatedAt}>{updatedLabel(project.updatedAt)}</time>
                                        </div>
                                        <div className="studio-progress" role="progressbar" aria-label={`${project.title}生成进度`} aria-valuenow={summary.progress} aria-valuemin={0} aria-valuemax={100}>
                                            <span style={{ width: `${summary.progress}%` }} />
                                        </div>
                                    </div>
                                </Link>
                                <Dropdown
                                    trigger={["click"]}
                                    placement="bottomRight"
                                    menu={{
                                        items: [
                                            {
                                                key: "rename",
                                                icon: <Pencil size={16} />,
                                                label: "重命名",
                                                onClick: () => {
                                                    setTitle(project.title);
                                                    setRenaming(project);
                                                },
                                            },
                                            {
                                                key: "copy",
                                                icon: <Copy size={16} />,
                                                label: "复制",
                                                onClick: () => {
                                                    importProject({
                                                        ...project,
                                                        title: `${project.title} 副本`,
                                                        pendingAgentRequest: undefined,
                                                        nodes: project.nodes.map((node) =>
                                                            node.metadata?.status === "loading"
                                                                ? { ...node, metadata: { ...node.metadata, status: "idle", progress: undefined, startedAt: undefined, imageTaskId: undefined, videoTaskId: undefined, audioTaskId: undefined } }
                                                                : node,
                                                        ),
                                                        chatSessions: project.chatSessions.map((session) => ({
                                                            ...session,
                                                            messages: session.messages.map((m) => (m.status === "running" || m.status === "thinking" ? { ...m, status: "waiting" } : m)),
                                                            agentState: { ...session.agentState, pendingTaskIds: [] },
                                                        })),
                                                    });
                                                    message.success("已复制项目");
                                                },
                                            },
                                            { key: "delete", icon: <Trash2 size={16} />, label: "删除", danger: true, onClick: () => remove(project) },
                                        ],
                                    }}
                                >
                                    <button type="button" className="studio-icon-button home-project-more" aria-label={`${project.title}更多操作`}>
                                        <MoreHorizontal />
                                    </button>
                                </Dropdown>
                            </article>
                        );
                    })
                ) : (
                    <div className="home-project-empty">
                        <FolderOpen />
                        <h3>{query ? "没有找到相关项目" : "还没有项目，先试一个模板"}</h3>
                        <p>{query ? "换个关键词，或从新的故事开始" : "从左侧选一个灵感，让故事有画面"}</p>
                        <button type="button" className="studio-button" onClick={onBlank}>
                            空白画布
                            <ArrowRight />
                        </button>
                    </div>
                )}
            </div>
            <Modal
                open={Boolean(renaming)}
                title="重命名项目"
                okText="保存"
                cancelText="取消"
                okButtonProps={{ disabled: !title.trim() }}
                onCancel={() => setRenaming(null)}
                onOk={() => {
                    if (renaming && title.trim()) {
                        renameProject(renaming.id, title);
                        setRenaming(null);
                    }
                }}
            >
                <Input
                    aria-label="项目名称"
                    autoFocus
                    maxLength={100}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onPressEnter={() => {
                        if (renaming && title.trim()) {
                            renameProject(renaming.id, title);
                            setRenaming(null);
                        }
                    }}
                />
            </Modal>
        </section>
    );
}

export function HomeQueue({ projects }: { projects: CanvasProject[] }) {
    const tasks = projects.flatMap((project) => projectSummary(project).running.map((node) => ({ project, node })));
    if (!tasks.length) return null;
    return (
        <section className="home-queue" aria-labelledby="queue-title">
            <div className="studio-section-header">
                <h2 id="queue-title">
                    正在生成 <span className="studio-muted">{tasks.length}</span>
                </h2>
                <span className="studio-muted">创作队列</span>
            </div>
            <div className="home-queue-list">
                {tasks.map(({ project, node }, index) => {
                    const progress = Math.max(0, Math.min(100, node.metadata?.progress || 0));
                    return (
                        <div className="home-queue-row" key={`${project.id}-${node.id}`}>
                            <ProjectThumbnail project={project} index={index} />
                            <strong>{project.title}</strong>
                            <span className="home-queue-step">
                                <LoaderCircle className="studio-spin" />
                                {node.title || "正在生成"}
                            </span>
                            <div className="studio-progress" role="progressbar" aria-label={`${node.title}进度`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                                <span style={{ width: `${progress}%` }} />
                            </div>
                            <span className="studio-muted home-queue-estimate">预计剩余：估算中</span>
                            <Link className="studio-text-link" href={`/canvas/${project.id}`}>
                                进入画布
                                <ArrowRight />
                            </Link>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
