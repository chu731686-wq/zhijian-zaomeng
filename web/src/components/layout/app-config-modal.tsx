"use client";

import { App, Button, Collapse, Form, Input, Modal, Select, Switch } from "antd";
import { useEffect, useRef, useState } from "react";

import { ModelChannelsPanel } from "@/components/models/model-channels-panel";
import { GrokTtsVoiceSelect } from "@/components/grok-tts-voice-select";
import { ModelPicker } from "@/components/model-picker";
import { fetchUserConfig, syncUserModelConfig } from "@/services/api/user-config";
import { audioFormatOptions, audioVoiceOptions, glmTtsFormatOptions, glmTtsVoiceOptions, isGlmTtsModel, normalizeAudioSpeedValue, normalizeGlmTtsFormat, normalizeGlmTtsSpeed, normalizeGlmTtsVoice } from "@/lib/audio-generation";
import { grokTtsFormatOptions, isGrok2APITtsConfig, normalizeGrokTtsFormat, normalizeGrokTtsSpeed } from "@/lib/grok-tts";
import { isGeminiConfig, isGeminiTtsModel } from "@/lib/gemini";
import { geminiTtsVoiceOptions, normalizeGeminiTtsVoice } from "@/lib/gemini-tts";
import { isMimoPresetTtsModel, isMimoTtsModel, isMimoVoiceDesignModel, mimoTtsFormatOptions, mimoTtsVoiceOptions } from "@/lib/mimo-tts";
import { isWorkflowProtocol } from "@/lib/model-channel";
import { listWorkflowChannels, replaceWorkflowChannels } from "@/services/workflow-channel-storage";
import { normalizeLocalChannels, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function AppConfigModal() {
    const { message } = App.useApp();
    const [saving, setSaving] = useState(false);
    const accountConfigRef = useRef<{ ready: boolean; workflowChannels?: import("@/lib/workflow-channel").WorkflowChannelData[] }>({ ready: false });
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const effectiveConfig = useEffectiveConfig();
    const modelChannel = publicSettings?.modelChannel;
    const isLoggedIn = Boolean(token && user);
    const canUseRemoteChannel = isLoggedIn && (user?.role === "admin" || modelChannel?.allowUserRemoteChannel === true);
    const allowCustomChannel = isLoggedIn && modelChannel?.allowCustomChannel === true;
    const effectiveMode = canUseRemoteChannel ? (allowCustomChannel ? config.channelMode : "remote") : "local";
    const modelConfig = effectiveMode === "remote" ? effectiveConfig : (config.channelMode === "local" ? config : { ...config, channelMode: "local" as const });
    const glmTts = isGlmTtsModel(config.audioModel);
    const grokTts = isGrok2APITtsConfig({ ...modelConfig, model: config.audioModel, audioModel: config.audioModel }, config.audioModel);
    const geminiTts = isGeminiTtsModel(config.audioModel) && isGeminiConfig({ ...modelConfig, model: config.audioModel, audioModel: config.audioModel }, config.audioModel);

    useEffect(() => {
        accountConfigRef.current = { ready: false };
        if (!isConfigOpen || !token || !user?.id) return;
        const accountToken = token;
        const accountId = user.id;
        let canceled = false;
        void fetchUserConfig(accountToken).then(async (payload) => {
            if (canceled || useUserStore.getState().token !== accountToken || useUserStore.getState().user?.id !== accountId) return;
            const remoteConfig = payload.modelConfig;
            const remoteWorkflowChannels = remoteConfig?.workflowChannels;
            if (remoteConfig) {
                const { workflowChannels, ...modelFields } = remoteConfig;
                delete modelFields.workflowSyncTouched;
                if (workflowChannels !== undefined) {
                    try {
                        await replaceWorkflowChannels(accountId, workflowChannels);
                        if (canceled || useUserStore.getState().token !== accountToken || useUserStore.getState().user?.id !== accountId) return;
                        updateConfig("workflowSyncTouched", true);
                    } catch {
                        if (canceled || useUserStore.getState().token !== accountToken || useUserStore.getState().user?.id !== accountId) return;
                        updateConfig("workflowSyncTouched", false);
                    }
                }
                if (canceled || useUserStore.getState().token !== accountToken || useUserStore.getState().user?.id !== accountId) return;
                Object.entries(modelFields).forEach(([key, value]) => updateConfig(key as keyof typeof config, value as never));
            }
            accountConfigRef.current = { ready: true, workflowChannels: remoteWorkflowChannels };
        }).catch(() => { });
        return () => { canceled = true; };
    }, [isConfigOpen, token, updateConfig, user?.id]);

    const finishConfig = async () => {
        const localIncomplete = effectiveMode === "local" && normalizeLocalChannels(config).filter((channel) => !isWorkflowProtocol(channel.protocol)).some((channel) => !channel.baseUrl.trim() || !channel.apiKey.trim());
        const modelIncomplete = !modelConfig.imageModel.trim() || !modelConfig.videoModel.trim() || !modelConfig.textModel.trim();
        if (token && !accountConfigRef.current.ready) {
            message.warning("账号配置仍在加载，请稍后再保存");
            return;
        }
        if (!canUseRemoteChannel && config.channelMode !== "local") updateConfig("channelMode", "local");
        else if (canUseRemoteChannel && !allowCustomChannel && config.channelMode !== "remote") updateConfig("channelMode", "remote");
        setSaving(true);
        try {
            if (token) {
                const configToSave = effectiveMode === "local" && config.channelMode !== "local" ? { ...config, channelMode: "local" as const } : config;
                const workflowChannels = normalizeLocalChannels(config).filter((channel) => isWorkflowProtocol(channel.protocol));
                let workflowData = accountConfigRef.current.workflowChannels;
                if (config.workflowSyncTouched) {
                    const stored = user?.id ? await listWorkflowChannels(user.id) : [];
                    const activeKeys = new Set(workflowChannels.map((channel) => `${channel.protocol}:${channel.id}`));
                    workflowData = stored.filter((channel) => activeKeys.has(`${channel.protocol}:${channel.channelId}`));
                }
                await syncUserModelConfig(token, configToSave, workflowData);
            }
            setConfigDialogOpen(false);
            if (localIncomplete || modelIncomplete) message.warning("部分模型或本地渠道密钥尚未配置完整，配置已保存");
            else message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
            clearPromptContinue();
        } catch (error) {
            message.error(error instanceof Error ? `同步配置失败：${error.message}` : "同步配置失败");
        } finally {
            setSaving(false);
        }
    };

    const advancedSettings = <Form layout="vertical" requiredMark={false}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {([
                { capability: "image" as const, modelKey: "imageModel" as const, channelKey: "imageChannelId" as const, workflowKey: "imageWorkflowRef" as const, label: "默认生图模型" },
                { capability: "video" as const, modelKey: "videoModel" as const, channelKey: "videoChannelId" as const, workflowKey: "videoWorkflowRef" as const, label: "默认视频模型" },
                { capability: "text" as const, modelKey: "textModel" as const, channelKey: "textChannelId" as const, label: "默认文本模型" },
                { capability: "audio" as const, modelKey: "audioModel" as const, channelKey: "audioChannelId" as const, workflowKey: "audioWorkflowRef" as const, label: "默认音频模型" },
            ]).map((group) => <Form.Item key={group.modelKey} label={group.label} className="mb-4">
                <ModelPicker config={modelConfig} value={modelConfig[group.modelKey]} channelId={modelConfig[group.channelKey]} workflowRef={group.workflowKey ? modelConfig[group.workflowKey] : undefined} onWorkflowChange={group.workflowKey ? (ref) => updateConfig(group.workflowKey!, ref) : undefined} onChange={(model, channelId) => { updateConfig(group.modelKey, model); if (channelId) updateConfig(group.channelKey, channelId); }} capability={group.capability} fullWidth />
            </Form.Item>)}
        </div>
        <div className="grid gap-4 md:grid-cols-4">
            <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                <Input type="number" min={1} max={15} value={config.canvasImageCount} onChange={(event) => updateConfig("canvasImageCount", event.target.value)} onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))} />
            </Form.Item>
            {geminiTts ? <Form.Item label="默认 Gemini 音色" className="mb-4"><Select showSearch optionFilterProp="label" value={normalizeGeminiTtsVoice(config.geminiTtsVoice)} options={geminiTtsVoiceOptions} onChange={(value) => updateConfig("geminiTtsVoice", value)} /></Form.Item>
                : isMimoPresetTtsModel(config.audioModel) ? <Form.Item label="默认 MiMo 音色" className="mb-4"><Select value={config.mimoTtsVoice} options={[...mimoTtsVoiceOptions]} onChange={(value) => updateConfig("mimoTtsVoice", value)} /></Form.Item>
                : isMimoVoiceDesignModel(config.audioModel) ? <Form.Item label="默认音色描述" className="mb-4"><Input value={config.mimoVoiceDesignPrompt} placeholder="例如：年轻女性，声音清亮自然，有亲和力。" onChange={(event) => updateConfig("mimoVoiceDesignPrompt", event.target.value)} /></Form.Item>
                : !isMimoTtsModel(config.audioModel) ? <Form.Item label="默认音频声音" className="mb-4">{grokTts ? <GrokTtsVoiceSelect config={modelConfig} model={config.audioModel} value={config.grokTtsVoice} enabled={isConfigOpen} onChange={(value) => updateConfig("grokTtsVoice", value)} /> : <Select value={glmTts ? normalizeGlmTtsVoice(config.glmTtsVoice) : config.audioVoice} options={glmTts ? glmTtsVoiceOptions : audioVoiceOptions} onChange={(value) => updateConfig(glmTts ? "glmTtsVoice" : "audioVoice", value)} />}</Form.Item> : null}
            {!geminiTts && <Form.Item label="默认音频格式" className="mb-4"><Select value={isMimoTtsModel(config.audioModel) ? config.mimoTtsFormat : glmTts ? normalizeGlmTtsFormat(config.glmTtsFormat) : grokTts ? normalizeGrokTtsFormat(config.grokTtsFormat) : config.audioFormat} options={isMimoTtsModel(config.audioModel) ? [...mimoTtsFormatOptions] : glmTts ? glmTtsFormatOptions : grokTts ? grokTtsFormatOptions : audioFormatOptions} onChange={(value) => isMimoTtsModel(config.audioModel) ? updateConfig("mimoTtsFormat", value) : updateConfig(glmTts ? "glmTtsFormat" : grokTts ? "grokTtsFormat" : "audioFormat", value)} /></Form.Item>}
            {!geminiTts && !isMimoTtsModel(config.audioModel) && <Form.Item label="默认音频语速" className="mb-4"><Input type="number" min={glmTts ? 0.5 : grokTts ? 0.7 : 0.25} max={glmTts ? 2 : grokTts ? 1.5 : 4} step={0.05} value={glmTts ? config.glmTtsSpeed : grokTts ? config.grokTtsSpeed : config.audioSpeed} onChange={(event) => updateConfig(glmTts ? "glmTtsSpeed" : grokTts ? "grokTtsSpeed" : "audioSpeed", event.target.value)} onBlur={(event) => updateConfig(glmTts ? "glmTtsSpeed" : grokTts ? "grokTtsSpeed" : "audioSpeed", glmTts ? normalizeGlmTtsSpeed(event.target.value) : grokTts ? normalizeGrokTtsSpeed(event.target.value) : normalizeAudioSpeedValue(event.target.value))} /></Form.Item>}
        </div>
        <div className="mb-1 grid gap-3 md:grid-cols-3">
            <FeatureSwitch title="流式传输" description="开启后请求中追加 stream，支持读取中间图片事件并避免长时间无数据。" checked={Boolean(config.streamImages)} onChange={(checked) => updateConfig("streamImages", checked ? "1" : "")} />
            <FeatureSwitch title="返回 Base64 图片数据" description="开启后 Image API 请求会追加 response_format: b64_json。" checked={Boolean(config.responseFormatB64Json)} onChange={(checked) => updateConfig("responseFormatB64Json", checked ? "1" : "")} />
            <FeatureSwitch title="Codex CLI 兼容模式" description="开启后减少不兼容参数，并追加防提示词改写前缀。" checked={Boolean(config.codexCli)} onChange={(checked) => updateConfig("codexCli", checked ? "1" : "")} />
        </div>
    </Form>;

    return <Modal title="模型与接口" open={isConfigOpen} width="min(1100px, calc(100vw - 32px))" centered onCancel={() => setConfigDialogOpen(false)} styles={{ body: { maxHeight: "78vh", overflowY: "auto" } }} footer={<Button type="primary" loading={saving} onClick={() => void finishConfig()}>完成</Button>}>
        <div className="pt-2"><ModelChannelsPanel embedded /></div>
        <Collapse className="mt-4" items={[{ key: "advanced", label: "高级设置", children: advancedSettings }]} />
    </Modal>;
}

function FeatureSwitch({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return <div className="rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800"><div className="flex items-center justify-between gap-3"><div className="text-sm font-medium">{title}</div><Switch checked={checked} onChange={onChange} /></div><div className="mt-1 text-xs leading-5 text-stone-500">{description}</div></div>;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}
