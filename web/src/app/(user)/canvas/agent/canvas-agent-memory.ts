import type { CanvasAgentProtocolMessage } from "../types";
import type { CanvasAgentToolDefinition } from "./canvas-agent-tools";

export const MAX_AGENT_INPUT_TOKENS = 96_000;
export const MAX_RECENT_PROTOCOL_TOKENS = 32_000;
export const MAX_COMPACTED_CONTEXT_TOKENS = 12_000;

type CanvasAgentInput = {
    systemPrompt: string;
    messages: CanvasAgentProtocolMessage[];
    tools: CanvasAgentToolDefinition[];
};

type CompactCanvasAgentHistoryInput = {
    protocolMessages: CanvasAgentProtocolMessage[];
    contextCheckpoint?: string;
    force?: boolean;
    createCheckpoint: (previousCheckpoint: string | undefined, messages: CanvasAgentProtocolMessage[]) => Promise<string>;
};

const calibrationFactors = new Map<string, number>();
const encoder = new TextEncoder();

export function estimateCanvasAgentInputTokens(input: CanvasAgentInput, calibrationKey?: string) {
    const base = estimateCanvasAgentInputTokensBase(input);
    return Math.ceil(base * (calibrationKey ? calibrationFactors.get(calibrationKey) || 1.25 : 1.25));
}

export function estimateCanvasAgentConversationTokens(messages: CanvasAgentProtocolMessage[], contextCheckpoint?: string) {
    return Math.ceil((estimateCanvasAgentProtocolTokens(messages) + estimateTextTokens(contextCheckpoint || "")) * 1.25);
}

export function hasEnoughCanvasAgentRoundsToCompact(messages: CanvasAgentProtocolMessage[]) {
    return groupProtocolMessages(messages).completedRounds.length >= 2;
}

export function calibrateCanvasAgentTokenEstimate(calibrationKey: string, input: CanvasAgentInput, actualInputTokens?: number) {
    if (!actualInputTokens || actualInputTokens <= 0) return;
    const base = estimateCanvasAgentInputTokensBase(input);
    if (!base) return;
    const nextFactor = Math.min(4, Math.max(1.08, (actualInputTokens / base) * 1.08));
    calibrationFactors.set(calibrationKey, Math.max(calibrationFactors.get(calibrationKey) || 0, nextFactor));
}

function estimateCanvasAgentProtocolTokens(messages: CanvasAgentProtocolMessage[]) {
    return messages.reduce((total, message) => total + estimateProtocolMessageTokens(message), 0);
}

export async function compactCanvasAgentHistory(input: CompactCanvasAgentHistoryInput) {
    const { fixedMessages, completedRounds, unfinishedRound } = groupProtocolMessages(input.protocolMessages);
    const keptRounds: CanvasAgentProtocolMessage[][] = [];
    const compactedRounds: CanvasAgentProtocolMessage[][] = [];
    let recentTokens = 0;

    for (let index = completedRounds.length - 1; index >= 0; index -= 1) {
        const round = completedRounds[index];
        const roundTokens = estimateCanvasAgentProtocolTokens(round);
        if (recentTokens + roundTokens <= MAX_RECENT_PROTOCOL_TOKENS) {
            keptRounds.unshift(round);
            recentTokens += roundTokens;
        } else {
            compactedRounds.unshift(round);
        }
    }

    if (input.force && !compactedRounds.length && keptRounds.length >= 2) compactedRounds.push(keptRounds.shift()!);
    const messagesToCompact = compactedRounds.flat();
    if (!messagesToCompact.length) {
        return { compacted: false, contextCheckpoint: input.contextCheckpoint, protocolMessages: input.protocolMessages };
    }

    const checkpointMessages: CanvasAgentProtocolMessage[] = [
        { role: "user", content: "生成长期对话检查点时必须保留：项目设定（受众/题材/集数/时长/横竖屏/画风）、用户已拍板的决定、当前做到哪一步和下一步、画布上关键节点的标题与 ID、用户的偏好和没做完的事。并在检查点中原样写一句：详细内容在画布节点里（如「项目设定」「剧名-后台」分组、主剧本节点），需要时用画布读取工具重新读。" },
        ...messagesToCompact,
    ];
    let checkpoint = await input.createCheckpoint(input.contextCheckpoint, checkpointMessages);
    if (!checkpoint.trim()) checkpoint = await input.createCheckpoint(input.contextCheckpoint, checkpointMessages);
    if (!checkpoint.trim()) {
        return { compacted: false, contextCheckpoint: input.contextCheckpoint, protocolMessages: input.protocolMessages };
    }
    return {
        compacted: true,
        contextCheckpoint: truncateToEstimatedTokens(checkpoint.trim(), MAX_COMPACTED_CONTEXT_TOKENS),
        protocolMessages: [...fixedMessages, ...keptRounds.flat(), ...unfinishedRound],
    };
}

export function serializeCanvasAgentMessagesForCheckpoint(messages: CanvasAgentProtocolMessage[]) {
    return messages.map((message) => {
        if (message.role === "assistant") {
            return {
                role: message.role,
                content: message.content || "",
                toolCalls: message.toolCalls?.map((call) => ({ name: call.name, arguments: call.arguments })),
            };
        }
        if (message.role === "tool") return { role: message.role, name: message.name, content: message.content };
        return { role: message.role, content: textContent(message.content) };
    });
}

function estimateCanvasAgentInputTokensBase(input: CanvasAgentInput) {
    return estimateTextTokens(input.systemPrompt)
        + estimateTextTokens(JSON.stringify(input.tools))
        + estimateCanvasAgentProtocolTokens(input.messages)
        + input.messages.length * 6
        + input.tools.length * 10;
}

function estimateProtocolMessageTokens(message: CanvasAgentProtocolMessage) {
    if (message.role === "assistant") {
        if (message.responseItems?.length) return estimateTextTokens(JSON.stringify(message.responseItems)) + 8;
        return estimateTextTokens(message.content || "")
            + estimateTextTokens(message.reasoningContent || "")
            + estimateTextTokens(JSON.stringify(message.toolCalls || []))
            + 8;
    }
    if (message.role === "tool") return estimateTextTokens(message.name) + estimateTextTokens(message.content) + 8;
    return estimateTextTokens(textContent(message.content)) + (typeof message.content === "string" ? 8 : message.content.filter((part) => part.type === "image_url").length * 1024 + 8);
}

function estimateTextTokens(value: string) {
    return value ? Math.ceil(encoder.encode(value).length / 3) : 0;
}

function textContent(content: Extract<CanvasAgentProtocolMessage, { role: "user" | "system" }>["content"]) {
    if (typeof content === "string") return content;
    return content.map((part) => part.type === "text" ? part.text : "[媒体引用]").join("\n");
}

function groupProtocolMessages(messages: CanvasAgentProtocolMessage[]) {
    const fixedMessages: CanvasAgentProtocolMessage[] = [];
    const rounds: CanvasAgentProtocolMessage[][] = [];
    let current: CanvasAgentProtocolMessage[] = [];

    messages.forEach((message) => {
        if (isRealUserMessage(message)) {
            if (current.length) rounds.push(current);
            current = [message];
        } else if (current.length) {
            current.push(message);
        } else {
            fixedMessages.push(message);
        }
    });
    if (current.length) rounds.push(current);

    const completedRounds: CanvasAgentProtocolMessage[][] = [];
    let unfinishedRound: CanvasAgentProtocolMessage[] = [];
    rounds.forEach((round, index) => {
        const completed = round.some((message, messageIndex) => message.role === "assistant" && !message.toolCalls?.length && !isFollowedByToolFallback(round, messageIndex));
        if (completed || index < rounds.length - 1) completedRounds.push(round);
        else unfinishedRound = round;
    });
    return { fixedMessages, completedRounds, unfinishedRound };
}

function isRealUserMessage(message: CanvasAgentProtocolMessage) {
    return message.role === "user" && !textContent(message.content).startsWith("工具执行结果（只可依据这些真实结果继续）：");
}

function isFollowedByToolFallback(round: CanvasAgentProtocolMessage[], index: number) {
    const next = round[index + 1];
    return next?.role === "user" && textContent(next.content).startsWith("工具执行结果（只可依据这些真实结果继续）：");
}

function truncateToEstimatedTokens(value: string, maxTokens: number) {
    if (estimateTextTokens(value) <= maxTokens) return value;
    let low = 0;
    let high = value.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (estimateTextTokens(value.slice(0, middle)) <= maxTokens) low = middle;
        else high = middle - 1;
    }
    return value.slice(0, low).replace(/[\uD800-\uDBFF]$/, "");
}
