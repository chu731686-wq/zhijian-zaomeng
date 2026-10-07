"use client";

import { useEffect, useMemo, useState } from "react";
import { App, Input, Select } from "antd";
import { Check, Eye, EyeOff, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { WebSearchSettingsPanel } from "./web-search-settings-panel";
import { fetchImageModels } from "@/services/api/image";
import { syncUserModelConfig } from "@/services/api/user-config";
import { filterModelsByCapability, normalizeLocalChannels, useConfigStore, type LocalModelChannel, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { isWorkflowProtocol, modelChannelDefaultBaseUrls, modelChannelProtocolOptions, type ModelChannelProtocol } from "@/lib/model-channel";

type Category = "all" | ModelCapability;
const categories: Array<{ key: Category; label: string }> = [{ key: "all", label: "全部" }, { key: "text", label: "文字" }, { key: "image", label: "图片" }, { key: "video", label: "视频" }, { key: "audio", label: "声音" }];
const capabilityCategories: Array<{ key: ModelCapability; label: string }> = categories.slice(1) as Array<{ key: ModelCapability; label: string }>;
type ChannelForm = Pick<LocalModelChannel, "id" | "protocol" | "name" | "baseUrl" | "apiKey" | "models">;
const freshChannel = (): ChannelForm => ({ id: `local-${Date.now()}`, protocol: "openai", name: "", baseUrl: modelChannelDefaultBaseUrls.openai, apiKey: "", models: [] });

function capabilities(channel: LocalModelChannel) {
    return capabilityCategories.filter(({ key }) => filterModelsByCapability(channel.models, key, channel.protocol).length).map(({ key }) => key);
}
function capabilityLabel(key: ModelCapability) { return capabilityCategories.find((category) => category.key === key)?.label || key; }

export function ModelChannelsPanel({ embedded = false }: { embedded?: boolean }) {
    const { message, modal } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const configDialogSource = useConfigStore((state) => state.configDialogSource);
    const selectAssistantModel = useConfigStore((state) => state.selectAssistantModel);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const token = useUserStore((state) => state.token);
    const channels = useMemo(() => normalizeLocalChannels(config).filter((channel) => !isWorkflowProtocol(channel.protocol)), [config]);
    const [category, setCategory] = useState<Category>("all");
    const [editing, setEditing] = useState<ChannelForm | null>(null);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    useEffect(() => { if (!isConfigOpen) setEditing(null); }, [isConfigOpen]);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [showKey, setShowKey] = useState(false);
    const [busy, setBusy] = useState(false);
    const [statuses, setStatuses] = useState<Record<string, { kind: "ok" | "error" | "waiting"; text: string }>>({});
    const shown = channels.filter((channel) => category === "all" || capabilities(channel).includes(category));
    const persist = async (items: LocalModelChannel[]) => {
        updateConfig("localChannels", items);
        updateConfig("channelMode", "local");
        const models = [...new Set(items.filter((item) => !isWorkflowProtocol(item.protocol)).flatMap((item) => item.models))];
        updateConfig("models", models);
        if (token) {
            try {
                await syncUserModelConfig(token, { ...config, channelMode: "local", localChannels: items, models });
            } catch {
                message.error("本地已保存，服务器同步失败，请检查网络后重试");
                return false;
            }
        }
        return true;
    };
    const openNew = () => { setEditing(freshChannel()); setAvailableModels([]); setShowKey(false); };
    const openEdit = (channel: LocalModelChannel) => { setEditing({ id: channel.id, protocol: channel.protocol, name: channel.name, baseUrl: channel.baseUrl, apiKey: channel.apiKey, models: [...channel.models] }); setAvailableModels([...channel.models]); setShowKey(false); };
    const updateForm = (patch: Partial<ChannelForm>) => setEditing((current) => current ? { ...current, ...patch } : current);
    const toConfig = (channel: ChannelForm) => ({ ...config, channelMode: "local" as const, baseUrl: channel.baseUrl, apiKey: channel.apiKey, localChannels: [channel], imageChannelId: channel.id, videoChannelId: channel.id, textChannelId: channel.id, audioChannelId: channel.id, model: channel.models[0] || config.model });
    const fetchModels = async (testOnly = false) => {
        if (!editing?.baseUrl.trim() || !editing.apiKey.trim()) return void message.warning("请先填写接口地址和密钥");
        setBusy(true);
        try {
            const available = await fetchImageModels(toConfig(editing));
            const models = [...new Set(available.map((model) => model.trim()).filter(Boolean))];
            if (testOnly) {
                setStatuses((current) => ({ ...current, [editing.id]: { kind: "ok", text: "已连通" } }));
                message.success("连接成功");
            } else {
                setAvailableModels([...new Set([...models, ...editing.models])]);
                message.success(`已获取 ${models.length} 个模型`);
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : "请检查接口地址和密钥";
            if (testOnly) setStatuses((current) => ({ ...current, [editing.id]: { kind: "error", text: `连接失败：${reason}` } }));
            message.error(testOnly ? `连接失败：${reason}` : reason);
        } finally { setBusy(false); }
    };

    const modelSelectionCount = editing ? availableModels.filter((model) => editing.models.includes(model)).length : 0;
    const allModelsSelected = availableModels.length > 0 && modelSelectionCount === availableModels.length;
    const toggleAllModels = () => {
        if (!editing) return;
        updateForm({ models: allModelsSelected ? [] : [...availableModels] });
    };
    const save = async () => {
        if (!editing) return;
        if (!editing.name.trim() || !editing.baseUrl.trim() || !editing.apiKey.trim()) return void message.warning("请填写名称、接口地址和密钥");
        const existing = normalizeLocalChannels(config).filter((channel) => channel.id !== editing.id);
        const saved = await persist([...existing, { ...editing, name: editing.name.trim(), baseUrl: editing.baseUrl.trim(), models: editing.models }]);
        setStatuses((current) => ({ ...current, [editing.id]: { kind: "waiting", text: "未测试" } }));
        setEditing(null);
        if (saved) message.success(token ? "模型接口已保存并同步" : "模型接口已保存");
    };
    const remove = (channel: LocalModelChannel) => {
        if (channels.length <= 1) return void message.info("至少保留一个模型接口");
        return modal.confirm({ title: `删除「${channel.name}」？`, content: "删除后，此接口的模型将不再用于创作。", okText: "确认删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: async () => { const saved = await persist(normalizeLocalChannels(config).filter((item) => item.id !== channel.id)); if (saved) message.success(token ? "已删除并同步" : "已删除"); } });
    };
    const testSaved = async (channel: LocalModelChannel) => {
        setBusy(true);
        try {
            const models = await fetchImageModels({ ...config, channelMode: "local", baseUrl: channel.baseUrl, apiKey: channel.apiKey, localChannels: [channel], imageChannelId: channel.id, videoChannelId: channel.id, textChannelId: channel.id, audioChannelId: channel.id });
            setStatuses((current) => ({ ...current, [channel.id]: { kind: "ok", text: `已连通 · ${models.length} 个模型` } }));
            message.success("连接成功");
        } catch (error) {
            const reason = error instanceof Error ? error.message : "请检查接口配置";
            setStatuses((current) => ({ ...current, [channel.id]: { kind: "error", text: `连接失败：${reason}` } }));
            message.error(`连接失败：${reason}`);
        } finally { setBusy(false); }
    };

    return <main className="home-page studio-list-page"><div className="home-content">
        <header className="studio-page-heading">{embedded ? <div><p className="studio-muted">填入接口地址和密钥，就能在画布里使用这家模型。密钥保存后只显示末四位。</p></div> : <div><p className="home-eyebrow">创作工具</p><h1>模型与接口</h1><p className="studio-muted">填入接口地址和密钥，就能在画布里使用这家模型。密钥保存后只显示末四位。</p></div>}<button type="button" className="studio-button is-primary" onClick={openNew}><Plus />接入新模型</button></header>
        {configDialogSource === "assistant" && <p className="studio-muted" role="status">点一个接口，用到画布助手</p>}
        <nav className="studio-category-tabs" aria-label="模型类型筛选">{categories.map(({ key, label }) => <button key={key} type="button" className={category === key ? "is-active" : ""} onClick={() => setCategory(key)}>{label}</button>)}</nav>
        {shown.length ? <div className="studio-model-list">{shown.map((channel) => {
            const status = statuses[channel.id] || { kind: "waiting" as const, text: "未测试" };
            const masked = channel.apiKey ? `••••${channel.apiKey.slice(-4)}` : "未填写密钥";
            return <article className="studio-model-card" key={channel.id}>
                <div className="studio-model-main"><div className="studio-model-title"><h2>{channel.name || "未命名接口"}</h2><span className="studio-model-protocol">{modelChannelProtocolOptions.find((item) => item.value === channel.protocol)?.label || channel.protocol}</span>{capabilities(channel).map((item) => <span className={`studio-model-type type-${item}`} key={item}>{capabilityLabel(item)}</span>)}</div>
                    <p className="studio-model-url" title={channel.baseUrl}>{channel.baseUrl}</p><p className="studio-model-secret">密钥 <code>{masked}</code></p>
                    <div className="studio-model-tags">{channel.models.length ? channel.models.slice(0, 8).map((model) => <span key={model}>{model}</span>) : <span className="studio-muted">尚未添加模型</span>}{channel.models.length > 8 && <span>+{channel.models.length - 8}</span>}</div></div>
                <div className={`studio-model-status is-${status.kind}`}><i />{status.text}</div>
                <div className="studio-model-actions">{configDialogSource === "assistant" && (["text", "image", "video"] as const).map((capability) => {
                    const firstModel = filterModelsByCapability(channel.models, capability, channel.protocol)[0];
                    return firstModel ? <button key={capability} type="button" className="studio-text-link" onClick={() => { selectAssistantModel(capability, channel.id, firstModel); setConfigDialogOpen(false); }}>{`用作${capabilityLabel(capability)}模型`}</button> : null;
                })}<button type="button" className="studio-text-link" onClick={() => void testSaved(channel)}><Check />测试连接</button><button type="button" className="studio-icon-button" aria-label="编辑接口" onClick={() => openEdit(channel)}><Pencil /></button><button type="button" className="studio-icon-button is-danger" aria-label="删除接口" onClick={() => remove(channel)}><Trash2 /></button></div>
            </article>;
        })}</div> : <section className="studio-empty-state"><div className="studio-empty-icon"><Plus /></div><h2>{category === "all" ? "还没有接入模型" : `还没有${capabilityLabel(category)}模型`}</h2><p>接入模型接口后，就可以在画布创作中使用。</p><button className="studio-button is-primary" onClick={openNew}><Plus />接入新模型</button></section>}
        <WebSearchSettingsPanel />
        {editing && <div className="studio-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><aside className="studio-model-drawer" role="dialog" aria-modal="true" aria-labelledby="model-drawer-title">
            <header><div><h2 id="model-drawer-title">{channels.some((item) => item.id === editing.id) ? "编辑模型接口" : "接入新模型"}</h2><p>配置接口后可在创作流程中选择模型</p></div><button type="button" className="studio-icon-button" aria-label="关闭" onClick={() => setEditing(null)}><X /></button></header>
            <div className="studio-drawer-fields"><label>显示名称<Input value={editing.name} placeholder="例如：我的 OpenAI 接口" onChange={(event) => updateForm({ name: event.target.value })} /></label>
                <label>接口类型<Select value={editing.protocol} options={modelChannelProtocolOptions.filter((item) => !isWorkflowProtocol(item.value)).map((item) => ({ ...item, label: item.label }))} onChange={(protocol: ModelChannelProtocol) => updateForm({ protocol, baseUrl: modelChannelDefaultBaseUrls[protocol] })} /></label>
                <label>接口地址<Input value={editing.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => { const baseUrl = event.target.value; updateForm({ baseUrl, ...(baseUrl.toLowerCase().includes("apimart.ai") ? { protocol: "apimart" as ModelChannelProtocol } : {}) }); }} /></label>
                <label>接口密钥<span className="studio-key-field"><Input type={showKey ? "text" : "password"} value={editing.apiKey} placeholder="填写 API Key" onChange={(event) => updateForm({ apiKey: event.target.value })} /><button type="button" className="studio-icon-button" aria-label={showKey ? "隐藏密钥" : "显示密钥"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff /> : <Eye />}</button></span></label>
                <section className="studio-fetch-models"><div><strong>可用模型</strong><p>保存后可按名称和类型筛选</p></div><button type="button" className="studio-button" disabled={busy} onClick={() => void fetchModels(false)}>{busy ? <LoaderCircle className="studio-spin" /> : <Plus />}获取模型列表</button></section>
                {availableModels.length > 0 && <>
                    <div className="studio-model-selection-summary">
                        <label><input type="checkbox" checked={allModelsSelected} ref={(input) => { if (input) input.indeterminate = modelSelectionCount > 0 && !allModelsSelected; }} onChange={toggleAllModels} />全选</label>
                        <span>已选 {modelSelectionCount} / 共 {availableModels.length}</span>
                    </div>
                    <div className="studio-model-picker">{availableModels.map((model) => <label key={model}><input type="checkbox" checked={editing.models.includes(model)} onChange={(event) => updateForm({ models: event.target.checked ? [...editing.models, model] : editing.models.filter((item) => item !== model) })} />{model}</label>)}</div>
                </>}
            </div>
            <footer><button type="button" className="studio-button" disabled={busy} onClick={() => void fetchModels(true)}>{busy ? "正在测试…" : "测试连接"}</button><button type="button" className="studio-button is-primary" onClick={save}>保存</button></footer>
        </aside></div>}
    </div></main>;
}
