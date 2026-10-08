"use client";

import { useEffect, useState } from "react";
import { App, Button, Spin } from "antd";
import { Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { acceptTeamInvite, previewTeamInvite, type TeamInvitePreview } from "@/services/api/team";
import { useUserStore } from "@/stores/use-user-store";

export default function TeamInvitePage() {
    const { message } = App.useApp();
    const router = useRouter();
    const { token: inviteToken } = useParams<{ token: string }>();
    const authToken = useUserStore((state) => state.token);
    const isReady = useUserStore((state) => state.isReady);
    const [invite, setInvite] = useState<TeamInvitePreview | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState(false);
    useEffect(() => {
        if (!isReady) return;
        if (!authToken) { router.replace(`/login?redirect=${encodeURIComponent(`/invite/team/${inviteToken}`)}`); return; }
        void previewTeamInvite(authToken, inviteToken).then(setInvite).catch((reason) => setError(reason instanceof Error ? reason.message : "邀请链接无效或已撤销")).finally(() => setLoading(false));
    }, [authToken, inviteToken, isReady, router]);
    const invalid = !invite || invite.expired || invite.revoked;
    const reason = invite?.revoked ? "这条邀请已撤销" : invite?.expired ? "这条邀请已过期" : error;
    const join = async () => {
        setJoining(true);
        try { const team = await acceptTeamInvite(authToken!, inviteToken); message.success("已加入团队"); router.replace(`/team/${team.id}`); }
        catch (reason) { message.error(reason instanceof Error ? reason.message : "加入失败"); }
        finally { setJoining(false); }
    };
    return <main className="home-page"><div className="home-content flex min-h-[60vh] items-center justify-center"><section className="w-full max-w-lg rounded-card border border-line bg-surface p-8 text-center shadow-sm">
        {loading ? <Spin /> : <><div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full border border-line bg-surface text-text"><Users /></div>{invalid ? <><h1 className="text-section-title font-semibold">邀请不可用</h1><p className="mt-3 text-muted-text">{reason || "这条邀请链接无效"}</p></> : <><p className="text-sm text-muted-text">{invite!.inviter_name} 邀请你加入</p><h1 className="mt-2 text-page-title font-semibold">{invite!.team_name}</h1><p className="mt-3 text-muted-text">加入身份：{invite!.role === "viewer" ? "只能看" : "可编辑"}</p><Button type="primary" className="mt-6" loading={joining} disabled={invite!.is_member} onClick={() => void join()}>{invite!.is_member ? "已加入团队" : "加入团队"}</Button></>}</>}
    </section></div></main>;
}
