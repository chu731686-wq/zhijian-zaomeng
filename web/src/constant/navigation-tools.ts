import { Blocks, Cpu, FolderOpen, House, Sparkles, Users } from "lucide-react";

export const navigationTools = [
    { slug: "", label: "首页", icon: House, group: "main" },
    { slug: "canvas", label: "我的项目", icon: FolderOpen, group: "main" },
    { slug: "team", label: "团队", icon: Users, group: "main" },
    { slug: "templates", label: "灵感广场 · 模板", icon: Blocks, group: "main" },
    { slug: "skills", label: "漫剧助手 · 技能", icon: Sparkles, group: "tools" },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
