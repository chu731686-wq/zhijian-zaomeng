"use client";

import { useEffect, useState, type ReactNode, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { App, Avatar, Dropdown, Modal, Popover } from "antd";
import { Bell, ChevronRight, Cpu, HardDrive, Info, LogOut, Menu, Plus, Search, UserRound } from "lucide-react";
import { navigationTools } from "@/constant/navigation-tools";
import { useUserStore } from "@/stores/use-user-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { ACCOUNT_IMPORT_EVENT, accountScope } from "@/services/account-storage";
import { fetchCurrentUser } from "@/services/api/auth";
import { AccountDataSync } from "./account-data-sync";
import { AppConfigModal } from "./app-config-modal";

export function AppShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { message } = App.useApp();
    const user = useUserStore((s) => s.user);
    const token = useUserStore((s) => s.token);
    const setSession = useUserStore((s) => s.setSession);
    const logout = useUserStore((s) => s.clearSession);
    const openConfig = useConfigStore((s) => s.openConfigDialog);
    const hydrated = useCanvasStore((s) => s.hydrated);
    const createProject = useCanvasStore((s) => s.createProject);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [accountInfo, setAccountInfo] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    const [pendingPage, setPendingPage] = useState<"templates" | "skills" | null>(null);
    useEffect(() => {
        if (!token || user?.role !== "admin") return;
        let active = true;
        const refresh = () => void fetchCurrentUser(token).then((freshUser) => {
            if (active && useUserStore.getState().token === token) setSession(token, freshUser);
        }).catch(() => {});
        const interval = window.setInterval(refresh, 30000);
        window.addEventListener("focus", refresh);
        return () => {
            active = false;
            window.clearInterval(interval);
            window.removeEventListener("focus", refresh);
        };
    }, [setSession, token, user?.role]);
    // Temporary entry points while the three destination pages are built in later cards.
    const handlePendingNavigation = (event: MouseEvent<HTMLDivElement>) => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
        const href = link?.getAttribute("href");
        if (!href || !["/templates", "/skills", "/models"].includes(href)) return;
        event.preventDefault();
        setMobileOpen(false);
        if (href === "/models") openConfig(false);
        else setPendingPage(href === "/templates" ? "templates" : "skills");
    };
    const isEditor = /^\/canvas\/[^/]+/.test(pathname);
    const name = user?.displayName || user?.username || "用户";
    const newProject = () => {
        if (!hydrated) return void message.info("画布数据正在加载，请稍后再试");
        router.push(`/canvas/${createProject("未命名项目")}`);
        setMobileOpen(false);
    };

    return (
        <>
            {isEditor ? (
                <div key={accountScope(token)} className="h-dvh overflow-hidden bg-background text-foreground">{children}</div>
            ) : (
                <div className="studio-shell">
                    {mobileOpen && <button type="button" className="studio-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}
                    <aside className={`studio-sidebar ${mobileOpen ? "is-open" : ""}`}>
                        <Link href="/" className="studio-brand" onClick={() => setMobileOpen(false)}>
                            <span className="studio-logo">
                                <img src="/brand/mark.svg" width={28} height={28} alt="" />
                            </span>
                            <span>
                                <strong>指尖造梦</strong>
                                <small>AI 漫剧工作室</small>
                            </span>
                        </Link>
                        <button type="button" className="studio-button is-primary studio-new-project" onClick={newProject} disabled={!hydrated}>
                            <Plus />
                            新建项目
                        </button>
                        <nav aria-label="主导航">
                            {navigationTools.map((tool, index) => {
                                const href = `/${tool.slug}`;
                                const active = pathname === href || (tool.slug && pathname.startsWith(`${href}/`));
                                const Icon = tool.icon;
                                return (
                                    <div key={tool.slug}>
                                        {index === 3 && <p className="studio-nav-heading">创作工具</p>}
                                        <Link href={href} prefetch={false} aria-current={active ? "page" : undefined} className={`studio-nav-item ${active ? "is-active" : ""}`} onClick={() => setMobileOpen(false)}>
                                            <Icon />
                                            <span>{tool.label}</span>
                                        </Link>
                                    </div>
                                );
                            })}
                        </nav>
                        <div className="studio-account-area">
                            <Dropdown
                                trigger={["click"]}
                                placement="topLeft"
                                menu={{
                                    items: [
                                        { key: "account", icon: <UserRound size={16} />, label: "账户信息", onClick: () => setAccountInfo(true) },
                                        { key: "import-local", icon: <HardDrive size={16} />, label: "上传本机画布和素材", onClick: () => window.dispatchEvent(new Event(ACCOUNT_IMPORT_EVENT)) },
                                        { key: "storage", icon: <HardDrive size={16} />, label: "存储", onClick: () => openConfig(false) },
                                        { key: "models", icon: <Cpu size={16} />, label: "模型与接口", onClick: () => router.push("/models") },
                                        { key: "about", icon: <Info size={16} />, label: "关于", onClick: () => setAboutOpen(true) },
                                        { type: "divider" },
                                        { key: "logout", icon: <LogOut size={16} />, label: "退出", disabled: !user, onClick: logout },
                                    ],
                                }}
                            >
                                <button type="button" className="studio-account" aria-label="打开账户菜单">
                                    <Avatar size={32} src={user?.avatarUrl || undefined} style={{ background: "var(--raised)", color: "var(--text)" }}>
                                        {name[0]}
                                    </Avatar>
                                    <span>
                                        <strong>{name}</strong>
                                    </span>
                                    <ChevronRight />
                                </button>
                            </Dropdown>
                        </div>
                    </aside>
                    <div className="studio-main">
                        <header className="studio-topbar">
                            <button type="button" className="studio-icon-button studio-mobile-menu" aria-label="打开导航" onClick={() => setMobileOpen(true)}>
                                <Menu />
                            </button>
                            <form action="/" method="get" className="studio-search">
                                <Search />
                                <input name="q" aria-label="搜索项目、模板、素材" placeholder="搜索项目、模板或素材" />
                                <button type="submit" className="studio-icon-button" aria-label="搜索">
                                    <ChevronRight />
                                </button>
                            </form>
                            <Popover
                                trigger="click"
                                placement="bottomRight"
                                content={
                                    <div className="studio-notifications">
                                        <Bell />
                                        <strong>暂无新通知</strong>
                                        <p>生成进度可在首页创作队列中查看</p>
                                    </div>
                                }
                            >
                                <button type="button" className="studio-icon-button" aria-label="通知">
                                    <Bell />
                                </button>
                            </Popover>
                        </header>
                        {user?.role === "admin" && user.usingDefaultPassword && <div role="alert" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "10px 16px", background: "#fff7e6", color: "#ad4e00" }}>
                            <span>管理员还在用默认密码，请立即修改</span>
                            <Link href="/admin/users" style={{ color: "inherit", fontWeight: 600, textDecoration: "underline" }}>去修改</Link>
                        </div>}
                        <div className="studio-page">{children}</div>
                    </div>
                </div>
            )}
            <Modal open={Boolean(pendingPage)} title={pendingPage === "templates" ? "灵感广场 · 模板" : "漫剧助手 · 技能"} footer={null} onCancel={() => setPendingPage(null)}>
                <p className="studio-muted">{pendingPage === "templates" ? "模板广场即将上线，首页可先使用三款灵感模板。" : "技能即将上线。已有技能可在首页输入 / 选择。"}</p>
                <Link href="/" className="studio-button" onClick={() => setPendingPage(null)}>
                    回到创作区
                </Link>
            </Modal>
            <AccountDataSync />
            <AppConfigModal />
            <Modal open={accountInfo} title="账户信息" footer={null} onCancel={() => setAccountInfo(false)}>
                <p>{name}</p>
                <p className="studio-muted">账号：{user?.username}</p>
            </Modal>
            <Modal open={aboutOpen} title="关于指尖造梦" footer={null} onCancel={() => setAboutOpen(false)}>
                <p>AI 漫剧工作室</p>
                <p className="studio-muted">基于开源项目 infinite-canvas</p>
            </Modal>
        </>
    );
}
