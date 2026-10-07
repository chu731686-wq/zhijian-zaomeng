"use client";

import { useEffect } from "react";
import { App } from "antd";
import { Globe2 } from "lucide-react";
import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useShowcaseStore } from "@/stores/use-showcase-store";
import { useUserStore } from "@/stores/use-user-store";

export function useProjectPublishing() {
    const { message } = App.useApp();
    const { user, token } = useUserStore();
    const { items, refresh, publish } = useShowcaseStore();
    const isAdmin = user?.role === "admin";
    useEffect(() => { if (isAdmin) void refresh(); }, [isAdmin, token, refresh]);
    const publishedIds = new Set(items.map((item) => item.id));
    const publishingItems = (project: CanvasProject) => isAdmin ? [{
        key: "publish", icon: <Globe2 size={16} />,
        label: publishedIds.has(project.id) ? "取消展示" : "设为作品展示",
        onClick: () => { void publish(project, !publishedIds.has(project.id)).then(() => message.success(publishedIds.has(project.id) ? "已取消展示" : "已设为作品展示")).catch((error: unknown) => message.error(error instanceof Error ? error.message : "发布失败")); },
    }] : [];
    return { publishedIds, publishingItems };
}

export function PublishedBadge() {
    return <span className="absolute right-3 top-3 z-10 rounded-md bg-accent px-2 py-1 text-xs text-background">展示中</span>;
}
