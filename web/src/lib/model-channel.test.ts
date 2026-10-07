import assert from "node:assert/strict";
import test from "node:test";
import { directAIProviderForProtocol, modelChannelApiKeyUrls, modelChannelDefaultBaseUrls, modelChannelProtocolOptions } from "./model-channel";

test("built-in protocol options retain both settings panels' labels and order", () => {
    assert.deepEqual(modelChannelProtocolOptions, [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "Grok2API", value: "grok2api" },
        { label: "MiniMax & METASO", value: "metaso" },
        { label: "APIMart", value: "apimart" },
        { label: "88API", value: "88api" },
        { label: "TokenDance", value: "tokendance" },
        { label: "RunningHub", value: "runninghub" },
        { label: "ComfyUI", value: "comfyui" },
        { label: "AutoDL", value: "autodl" },
        { label: "火山方舟", value: "ark" },
        { label: "KIE", value: "kie" },
        { label: "MiMo", value: "mimo" },
    ]);
});

test("built-in protocols retain all existing default URLs and API Key links", () => {
    assert.deepEqual(modelChannelDefaultBaseUrls, {
        openai: "https://api.openai.com",
        gemini: "https://generativelanguage.googleapis.com",
        grok2api: "",
        metaso: "https://metaso.cn/api/minimax",
        apimart: "https://api.apimart.ai/v1",
        runninghub: "https://www.runninghub.cn",
        comfyui: "",
        autodl: "https://autodl.art",
        ark: "https://ark.cn-beijing.volces.com/api/v3",
        kie: "https://api.kie.ai/api/v1",
        mimo: "https://api.xiaomimimo.com",
        "88api": "https://88api.ai/v1",
        tokendance: "https://tokendance.space/gateway/v1",
    });
    assert.deepEqual(modelChannelApiKeyUrls, {
        metaso: "https://metaso.cn/minimax-h3/?s=tt",
        apimart: "https://apimart.ai/register?aff=fWMrEv",
        mimo: "https://platform.xiaomimimo.com/?ref=JFZQR2",
        "88api": "https://88api.ai/sign-up?aff=25ty",
    });
});

test("public parameter translation eligibility keeps exact protocol matching", () => {
    assert.equal(directAIProviderForProtocol("kie"), "kie");
    assert.equal(directAIProviderForProtocol("apimart"), "apimart");
    assert.equal(directAIProviderForProtocol("autodl"), "autodl");
    assert.equal(directAIProviderForProtocol("ark"), "ark");
    assert.equal(directAIProviderForProtocol("tokendance"), "tokendance");
    for (const protocol of ["openai", "gemini", "grok2api", "metaso", "mimo", "88api", "KIE", " kie ", "APIMart", "ARK", " ark ", "", "unknown"]) {
        assert.equal(directAIProviderForProtocol(protocol), null, protocol);
    }
});
