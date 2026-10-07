"use client";

import { Select } from "antd";
import { useEffect, useRef, useState } from "react";

import { fetchGrokTtsVoices } from "@/services/api/audio";
import { channelIdForActiveModel, localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { GrokTtsVoice } from "@/lib/grok-tts";

type GrokTtsVoiceSelectProps = {
    config: AiConfig;
    model: string;
    value: string;
    onChange: (value: string) => void;
    enabled?: boolean;
};

export function GrokTtsVoiceSelect({ config, model, value, onChange, enabled = true }: GrokTtsVoiceSelectProps) {
    const configRef = useRef(config);
    const token = useUserStore((state) => state.token);
    const [voices, setVoices] = useState<GrokTtsVoice[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reload, setReload] = useState(0);
    configRef.current = config;

    const requestConfig = { ...config, model, audioModel: model };
    const channelId = channelIdForActiveModel(requestConfig);
    const localChannel = localChannelForActiveModel(requestConfig);
    const requestKey = `${config.channelMode}|${channelId}|${model}|${localChannel?.baseUrl || config.baseUrl}|${token}`;

    useEffect(() => {
        if (!enabled) return;
        let active = true;
        setLoading(true);
        setError("");
        void fetchGrokTtsVoices(configRef.current, model)
            .then((items) => {
                if (active) setVoices(items);
            })
            .catch((reason) => {
                if (active) setError(reason instanceof Error ? reason.message : "音色读取失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [enabled, model, reload, requestKey]);

    const options = voices.map((voice) => ({ value: voice.voice_id, label: voice.name || voice.voice_id }));
    if (value && !options.some((item) => item.value === value)) options.unshift({ value, label: value });

    return (
        <Select
            className="w-full"
            value={value || "eve"}
            options={options}
            loading={loading}
            showSearch
            optionFilterProp="label"
            notFoundContent={loading ? "正在读取音色…" : error || "暂无可用音色"}
            onOpenChange={(open) => {
                if (open && error) setReload((value) => value + 1);
            }}
            onChange={onChange}
        />
    );
}
