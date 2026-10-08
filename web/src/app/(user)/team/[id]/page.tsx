"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Avatar, Button, Input, Modal, Select, Spin, Switch, Checkbox, Table } from "antd";
import { ArrowLeft, Link as LinkIcon, Pencil, Shield, Trash2, UserMinus, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createTeamInvite, dissolveTeam, getTeam, getTeamSharedChannels, saveTeamSharedChannels, getTeamAPIUsage, type TeamSharedChannel, type TeamAPIUsage, removeTeamMember, renameTeam, transferTeam, updateTeamMember, type TeamDetail, type TeamMember, type TeamRole } from "@/services/api/team";
import { useUserStore } from "@/stores/use-user-store";

import { fetchUserConfig } from "@/services/api/user-config";
import type { LocalModelChannel } from "@/stores/use-config-store";
import { isWorkflowProtocol } from "@/lib/model-channel";

const roleLabel: Record<TeamRole, string> = { owner: "队长", admin: "管理员", editor: "可编辑", viewer: "只能看" };

export default function TeamDetailPage() {
    const { message, modal } = App.useApp();
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const id = params.id;
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const [team, setTeam] = useState<TeamDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [renameOpen, setRenameOpen] = useState(false);
    const [teamName, setTeamName] = useState("");
    const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
    const [inviteUrl, setInviteUrl] = useState("");
    const [sharedChannels, setSharedChannels] = useState<TeamSharedChannel[]>([]);
    const [configuredChannels, setConfiguredChannels] = useState<LocalModelChannel[]>([]);
    const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
    const [usage, setUsage] = useState<TeamAPIUsage[]>([]);
    const [sharingLoading, setSharingLoading] = useState(true);
    const [sharingSaving, setSharingSaving] = useState(false);
    const [sharingError, setSharingError] = useState("");
    useEffect(() => {
        if (!token || !team) return;
        let active = true;
        setSharingLoading(true); setSharingError(""); setUsage([]);
        const load = async () => {
            try {
                const channels = await getTeamSharedChannels(token, id);
                const [configuration, records] = team.role === "owner" ? await Promise.all([fetchUserConfig(token), getTeamAPIUsage(token, id)]) : [null, []];
                if (!active) return;
                setSharedChannels(channels); setSelectedChannels(channels.map((channel) => channel.channel_id));
                setConfiguredChannels(configuration?.modelConfig?.localChannels || []); setUsage(records);
            } catch (error) { if (active) setSharingError(error instanceof Error ? error.message : "团队接口加载失败"); }
            finally { if (active) setSharingLoading(false); }
        };
        void load();
        return () => { active = false; };
    }, [token, id, team?.role]);
    const saveSharing = async () => {
        if (!token) return;
        setSharingSaving(true);
        try {
            const channels = await saveTeamSharedChannels(token, id, selectedChannels);
            setSharedChannels(channels); setSelectedChannels(channels.map((channel) => channel.channel_id));
            message.success("团队开放接口已保存");
        } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
        finally { setSharingSaving(false); }
    };
    const refresh = useCallback(() => { if (token) void getTeam(token, id).then(setTeam).catch((error) => message.error(error.message)).finally(() => setLoading(false)); }, [id, token]);
    useEffect(() => { refresh(); }, [refresh]);
    if (loading) return <div className="py-20 text-center"><Spin /></div>;
    if (!team) return <main className="home-page"><div className="home-content"><Button type="link" onClick={() => router.push("/team")}>返回团队</Button><p className="mt-6 text-muted-text">无法加载团队信息</p></div></main>;
    const owner = team.role === "owner";
    const manager = owner || team.role === "admin";
    const memberOptions = team.members.filter((member) => member.role !== "owner");
    const confirm = (title: string, onOk: () => Promise<unknown>, danger = false) => modal.confirm({ title, okText: "确认", cancelText: "取消", okButtonProps: danger ? { danger: true } : undefined, onOk });
    const invite = async () => {
        try { const result = await createTeamInvite(token!, id, inviteRole); const url = `${location.origin}/invite/team/${result.token}`; setInviteUrl(url); await navigator.clipboard.writeText(url); message.success("已复制"); }
        catch (error) { message.error(error instanceof Error ? error.message : "邀请链接生成失败"); }
    };
    const copyInviteUrl = async () => {
        if (!inviteUrl) return;
        try { await navigator.clipboard.writeText(inviteUrl); message.success("已复制"); }
        catch { message.error("复制失败，请手动复制链接"); }
    };
    const changeRole = async (member: TeamMember, role: TeamRole) => { try { await updateTeamMember(token!, id, member.user_id, { role }); refresh(); } catch (error) { message.error(error instanceof Error ? error.message : "身份修改失败"); } };
    const kick = (member: TeamMember) => confirm(`确认将 ${member.name} 移出团队？`, async () => { await removeTeamMember(token!, id, member.user_id); refresh(); }, true);
    const updateApi = async (member: TeamMember, enabled: boolean) => { try { await updateTeamMember(token!, id, member.user_id, { can_use_team_api: enabled }); refresh(); } catch (error) { message.error(error instanceof Error ? error.message : "设置失败"); } };
    return <main className="home-page"><div className="home-content">
        <div className="flex justify-start"><Button className="text-left" type="text" icon={<ArrowLeft size={16} />} onClick={() => router.push("/team")}>所有团队</Button></div>
        <header className="studio-page-heading mt-4"><div><p className="home-eyebrow">团队空间</p><h1>{team.name}</h1><p className="mt-2 text-sm text-muted-text">{team.member_count} 位成员</p></div><div className="flex flex-wrap gap-2">{manager && <Button icon={<LinkIcon size={16} />} onClick={() => void invite()}>生成邀请链接</Button>}{manager && <Button icon={<Pencil size={16} />} onClick={() => { setTeamName(team.name); setRenameOpen(true); }}>改名</Button>}{owner && <Button danger icon={<Trash2 size={16} />} onClick={() => confirm("解散团队？团队画布将归还给队长。", async () => { await dissolveTeam(token!, id); router.push("/team"); }, true)}>解散团队</Button>}</div></header>
        {manager && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-sm text-muted-text">邀请身份</span><Select aria-label="邀请身份" value={inviteRole} onChange={setInviteRole} options={[{ value: "editor", label: "可编辑" }, { value: "viewer", label: "只能看" }]} /></div>}
        {inviteUrl && <div className="mt-3 max-w-2xl"><div className="flex gap-2"><Input aria-label="邀请链接" readOnly value={inviteUrl} /><Button onClick={() => void copyInviteUrl()}>复制</Button></div><p className="mt-1 text-xs text-muted-text">7 天内有效</p></div>}
        <section className="mt-8 rounded-card border border-line bg-surface p-5"><h2 className="mb-5 flex items-center gap-2 text-section-title font-semibold"><Users size={19} />成员</h2><div className="divide-y divide-line">{team.members.map((member) => {
            const editableRoles: TeamRole[] = owner ? ["admin", "editor", "viewer"] : ["editor", "viewer"];
            const canChangeRole = manager && member.role !== "owner" && (owner || member.role === "editor" || member.role === "viewer");
            return <div key={member.user_id} className="flex flex-wrap items-center gap-3 py-4"><Avatar src={member.avatar || undefined}>{member.name[0]}</Avatar><div className="min-w-32 flex-1"><strong>{member.name}{member.user_id === user?.id ? "（我）" : ""}</strong><p className="mt-1 text-xs text-muted-text">{roleLabel[member.role]}</p></div>
                {owner && member.role !== "owner" && <label className="flex items-center gap-2 text-sm text-muted-text"><Switch size="small" checked={member.can_use_team_api} onChange={(checked) => void updateApi(member, checked)} />可用团队接口</label>}
                {canChangeRole && <Select aria-label={`${member.name}身份`} value={member.role} style={{ width: 116 }} onChange={(role: TeamRole) => void changeRole(member, role)} options={editableRoles.map((role) => ({ value: role, label: roleLabel[role] }))} />}
                {owner && member.role !== "owner" && <Button type="text" icon={<Shield size={16} />} onClick={() => confirm(`将队长转让给 ${member.name}？`, async () => { await transferTeam(token!, id, member.user_id); refresh(); })}>转让队长</Button>}
                {member.role !== "owner" && (member.user_id === user?.id || owner || (team.role === "admin" && (member.role === "editor" || member.role === "viewer"))) && <Button danger type="text" icon={<UserMinus size={16} />} onClick={() => kick(member)}>{member.user_id === user?.id ? "退出" : "移出"}</Button>}
            </div>;
        })}</div></section>
        <section className="mt-6 rounded-card border border-line bg-surface p-5">
            <h2 className="text-section-title font-semibold">开放接口给团队</h2>
            <p className="mt-2 text-sm text-muted-text">成员在本队画布的模型选择中使用开放接口。队长可在成员列表开启“可用团队接口”。</p>
            {sharingLoading ? <div className="py-6"><Spin /></div> : sharingError ? <p className="mt-4 text-sm text-muted-text">{sharingError}</p> : owner ? <>
                <div className="my-4 flex flex-col gap-3">{configuredChannels.length ? configuredChannels.map((channel) => <label key={channel.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Checkbox disabled={sharingSaving || isWorkflowProtocol(channel.protocol)} checked={selectedChannels.includes(channel.id)} onChange={(event) => setSelectedChannels((ids) => event.target.checked ? [...ids, channel.id] : ids.filter((id) => id !== channel.id))}>{channel.name || "未命名接口"}</Checkbox>
                    <span className="text-xs text-muted-text">{isWorkflowProtocol(channel.protocol) ? "暂不支持开放给团队" : `${channel.models.length} 个模型`}</span>
                </label>) : <p className="text-sm text-muted-text">还没有保存到账号的接口，请先到“模型接入”配置并保存。</p>}</div>
                <Button type="primary" loading={sharingSaving} onClick={() => void saveSharing()}>保存开放接口</Button>
                <Button type="link" onClick={() => router.push("/models")}>管理自己的接口</Button>
            </> : <div className="mt-4 space-y-3">{sharedChannels.length ? sharedChannels.map((channel) => <div key={channel.channel_id}><strong className="text-sm">{channel.name}</strong><p className="mt-1 text-xs text-muted-text">{channel.models.map((model) => model.name).join("、") || "暂无模型"}</p></div>) : <p className="text-sm text-muted-text">队长尚未开放接口</p>}</div>}
        </section>
        {owner && <section className="mt-6 rounded-card border border-line bg-surface p-5">
            <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-section-title font-semibold">接口用量记录</h2><Button loading={sharingLoading} onClick={() => { if (token) void getTeamAPIUsage(token, id).then(setUsage).catch((error) => message.error(error.message)); }}>刷新</Button></div>
            <Table<TeamAPIUsage> size="small" rowKey="id" dataSource={usage} loading={sharingLoading} scroll={{ x: 580 }} pagination={{ pageSize: 10 }} locale={{ emptyText: "暂无用量记录" }} columns={[
                { title: "时间", dataIndex: "created_at", render: (value: string) => new Date(value).toLocaleString("zh-CN") },
                { title: "成员", dataIndex: "member_name", render: (value: string, item) => value || item.user_id },
                { title: "模型", dataIndex: "model", render: (value: string) => value || "—" },
                { title: "状态", dataIndex: "status", render: (value: number) => `${value >= 200 && value < 300 ? "成功" : "失败"}（${value}）` },
            ]} />
        </section>}
        <Modal title="修改团队名称" open={renameOpen} okText="保存" cancelText="取消" onCancel={() => setRenameOpen(false)} onOk={async () => { try { await renameTeam(token!, id, teamName); setRenameOpen(false); refresh(); message.success("已更新"); } catch (error) { message.error(error instanceof Error ? error.message : "修改失败"); } }}><Input maxLength={40} value={teamName} onChange={(event) => setTeamName(event.target.value)} /></Modal>
    </div></main>;
}
