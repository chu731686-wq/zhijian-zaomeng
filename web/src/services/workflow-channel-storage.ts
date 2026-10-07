import localforage from "localforage";

import type { WorkflowChannelData, WorkflowEntry } from "@/lib/workflow-channel";

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "workflow_channels" });
const accountKey = (accountId: string) => encodeURIComponent(accountId || "guest");
let writeQueue = Promise.resolve();

function queueWrite(write: () => Promise<void>) {
    const next = writeQueue.then(write, write);
    writeQueue = next.catch(() => undefined);
    return next;
}

async function readAccountChannels(accountId: string) {
    return (await store.getItem<WorkflowChannelData[]>(accountKey(accountId))) || [];
}

export async function readWorkflowChannel(accountId: string, protocol: WorkflowChannelData["protocol"], channelId: string): Promise<WorkflowEntry[]> {
	await writeQueue;
	const channels = await readAccountChannels(accountId);
    return channels.find((channel) => channel.protocol === protocol && channel.channelId === channelId)?.workflows || [];
}

export async function saveWorkflowChannel(accountId: string, protocol: WorkflowChannelData["protocol"], channelId: string, workflows: WorkflowEntry[]) {
    await queueWrite(async () => {
        const channels = await readAccountChannels(accountId);
        const index = channels.findIndex((channel) => channel.protocol === protocol && channel.channelId === channelId);
        const updatedChannels = [...channels];
        const channel = { protocol, channelId, workflows };
        if (index >= 0) updatedChannels[index] = channel;
        else updatedChannels.push(channel);
        await store.setItem(accountKey(accountId), updatedChannels);
    });
}

export async function listWorkflowChannels(accountId: string): Promise<WorkflowChannelData[]> {
	await writeQueue;
	return readAccountChannels(accountId);
}

export async function replaceWorkflowChannels(accountId: string, channels: WorkflowChannelData[]) {
    await queueWrite(() => store.setItem(accountKey(accountId), channels).then(() => undefined));
}
