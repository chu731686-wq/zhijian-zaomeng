import assert from "node:assert/strict";
import test from "node:test";
import type { ModelChannelProtocol } from "@/lib/model-channel";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import {
    isAPIMartKlingMotionControlConfig, isAPIMartKlingV26Config, isAPIMartKlingV3Config,
    isKIEGrokVideoModel, isKIEKlingMotionControlConfig, isKIEKlingV3Config, kieKlingOmniVariant,
    klingV26DurationOptions, klingV26ModeOptions, klingV3DurationOptions, klingV3ModeOptions,
    normalizeKlingV26Duration, normalizeKlingV26Ratio, normalizeKlingV3Duration,
} from "./kling-models";

function configFor(model: string, protocol: ModelChannelProtocol = "openai", name = "custom"): AiConfig {
    return {
        ...defaultConfig,
        channelMode: "local", model, videoModel: model, imageModel: "", audioModel: "", textModel: "",
        activeChannelId: "chosen", videoChannelId: "chosen", imageChannelId: "", audioChannelId: "", textChannelId: "",
        models: [model], publicChannels: [],
        localChannels: [{ id: "chosen", protocol, name, baseUrl: "https://proxy.example", apiKey: "local-key", models: [model] }],
    };
}

test("Kling panel matching keeps channel descriptions distinct from protocol selection", () => {
    const model = "kling-v3";
    assert.equal(isAPIMartKlingV3Config(configFor(model, "apimart"), model), false);
    assert.equal(isAPIMartKlingV3Config(configFor(model, "openai", "APIMart channel"), model), true);
    const byURL = configFor(model);
    byURL.localChannels[0].baseUrl = "https://api.apimart.ai/v1";
    assert.equal(isAPIMartKlingV3Config(byURL, model), true);
    const remote = configFor(model);
    remote.channelMode = "remote";
    remote.publicChannels = [{ id: "chosen", protocol: "openai", models: [model], remark: "APIMART" }];
    assert.equal(isAPIMartKlingV3Config(remote, model), true);
    assert.equal(isAPIMartKlingV3Config(remote, "kling-v3-extra"), false);
});

test("same model on different channels retains the selected channel identity", () => {
    const model = "kling-v3";
    const config = configFor(model);
    config.localChannels.unshift({ ...config.localChannels[0], id: "other", name: "APIMart" });
    assert.equal(isAPIMartKlingV3Config(config, model), false);
    config.videoChannelId = "other";
    assert.equal(isAPIMartKlingV3Config(config, model), true);
});

test("Kling model variants keep existing exact normalized matches", () => {
    const apimart = configFor("kling-v2.6", "openai", "APIMart");
    assert.equal(isAPIMartKlingV26Config(apimart, "kling-v2.6"), true);
    assert.equal(isAPIMartKlingMotionControlConfig(apimart, "kling-v2.6-motion-control"), true);
    const kie = configFor("kling-3.0/video", "openai", "KIE");
    assert.equal(isKIEKlingV3Config(kie, "kling-3.0/video"), true);
    assert.equal(isKIEKlingMotionControlConfig(kie, "kling-2.6/motion-control"), true);
    assert.equal(isKIEKlingMotionControlConfig(kie, "kling-3.0/motion-control"), true);
    for (const variant of ["text-to-video", "image-to-video", "reference-to-video", "transformation"]) {
        const model = `kling-3.0-omni/${variant}`;
        assert.equal(kieKlingOmniVariant(kie, model), variant);
        assert.equal(isKIEKlingV3Config(kie, model), true);
    }
    assert.equal(kieKlingOmniVariant(kie, "kling-3.0-omni/unknown"), "");
});

test("KIE Grok detection remains protocol-based, unlike Kling panel detection", () => {
    const model = "grok-imagine/text-to-video";
    assert.equal(isKIEGrokVideoModel(configFor(model, "openai", "KIE"), model), false);
    assert.equal(isKIEGrokVideoModel(configFor(model, "kie"), model), true);
    assert.equal(isKIEGrokVideoModel(configFor(model, "kie"), "grok-imagine-video"), false);
});

test("panel duration and ratio normalization preserve all existing boundaries", () => {
    for (const [value, expected] of [["10", 10], [" 10 ", 10], ["10.0", 5], ["12", 5], ["", 5], ["-1", 5]] as const) {
        assert.equal(normalizeKlingV26Duration(value), expected);
    }
    for (const [value, expected] of [["", 3], ["invalid", 3], ["-1", 3], ["2", 3], ["5.9", 5], ["15", 15], ["16", 15]] as const) {
        assert.equal(normalizeKlingV3Duration(value), expected);
    }
    for (const [value, expected] of [["9:16", "9:16"], [" 1080x1920 ", "9:16"], ["1024x1024", "1:1"], ["960x960", "16:9"], ["auto", "16:9"]] as const) {
        assert.equal(normalizeKlingV26Ratio(value), expected);
    }
    assert.deepEqual(klingV26DurationOptions, [5, 10]);
    assert.deepEqual(klingV3DurationOptions, [3, 15]);
    assert.deepEqual(klingV26ModeOptions.map(({ value }) => value), ["std", "pro"]);
    assert.deepEqual(klingV3ModeOptions.map(({ value }) => value), ["std", "pro", "4k"]);
});
