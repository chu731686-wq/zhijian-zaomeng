"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { isPublicAuthPage } from "@/lib/auth-routes";

export default function UserLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    if (isPublicAuthPage(pathname)) return <>{children}</>;
    return <AppShell>{children}</AppShell>;
}
