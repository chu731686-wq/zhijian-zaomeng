import { CanvasCollabError, getCanvasChanges, getCanvasSnapshot, postCanvasPatch, type CanvasPatch, type CanvasPresence, type CanvasSnapshot } from "@/services/api/canvas-collab";
import { syncMediaReferences } from "@/services/sync-media";
import type { CanvasProject } from "../stores/use-canvas-store";

type Data = Record<string, unknown>;
type Item = Data & { id: string };
const privateFields = new Set(["viewport", "chatSessions", "activeChatId", "agentConfig", "pendingAgentRequest", "sidePanel", "agentPanel", "team_id", "team_name", "can_edit", "can_manage_access", "updatedAt"]);
const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const equal = (a: unknown, b: unknown) => a === b || serialize(a) === serialize(b);
const samePatch = (a: CanvasPatch, b: CanvasPatch) => equal({ set: a.set || {}, upsert: a.upsert || {}, delete: a.delete || {} }, { set: b.set || {}, upsert: b.upsert || {}, delete: b.delete || {} });
const collection = (value: unknown): value is Item[] => Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof item.id === "string");
export function sharedCanvasData(project: Partial<CanvasProject>): Data {
    return Object.fromEntries(Object.entries(project).filter(([key]) => !privateFields.has(key)));
}
export function diffCanvasData(before: Data, after: Data): CanvasPatch {
    const patch: CanvasPatch = {};
    for (const [key, value] of Object.entries(after)) {
        if (privateFields.has(key) || equal(before[key], value)) continue;
        if (collection(value) && (before[key] === undefined || collection(before[key]))) {
            const old = new Map(((before[key] || []) as Item[]).map((item) => [item.id, item]));
            const updates: Item[] = [];
            for (const item of value) {
                const previous = old.get(item.id);
                const changed: Item = { id: item.id };
                for (const field of new Set([...Object.keys(previous || {}), ...Object.keys(item)])) {
                    if (field !== "id" && (!previous || !equal(previous[field], item[field]))) changed[field] = item[field] ?? null;
                }
                if (!previous || Object.keys(changed).length > 1) updates.push(changed);
            }
            if (updates.length) (patch.upsert ||= {})[key] = updates;
            const ids = new Set(value.map((item) => item.id));
            const removed = [...old.keys()].filter((id) => !ids.has(id));
            if (removed.length) (patch.delete ||= {})[key] = removed;
        } else (patch.set ||= {})[key] = value;
    }
    return patch;
}
export function applyCanvasPatch(data: Data, patch: CanvasPatch): Data {
    const next = { ...data, ...Object.fromEntries(Object.entries(patch.set || {}).filter(([key]) => !privateFields.has(key))) };
    for (const [key, updates] of Object.entries(patch.upsert || {})) {
        if (privateFields.has(key)) continue;
        const items = new Map(((next[key] || []) as Item[]).map((item) => [item.id, item]));
        for (const item of updates) items.set(item.id, { ...items.get(item.id), ...item });
        next[key] = [...items.values()];
    }
    for (const [key, ids] of Object.entries(patch.delete || {})) {
        if (!privateFields.has(key)) next[key] = ((next[key] || []) as Item[]).filter((item) => !ids.includes(item.id));
    }
    return next;
}
function mergePatches(first: CanvasPatch, second: CanvasPatch): CanvasPatch {
    const result: CanvasPatch = { set: { ...first.set, ...second.set }, upsert: {}, delete: {} };
    for (const key of new Set([...Object.keys(first.upsert || {}), ...Object.keys(second.upsert || {}), ...Object.keys(first.delete || {}), ...Object.keys(second.delete || {})])) {
        const items = new Map<string, Item>();
        for (const item of [...(first.upsert?.[key] || []), ...(second.upsert?.[key] || [])]) items.set(item.id, { ...items.get(item.id), ...item });
        const deleted = [...new Set([...(first.delete?.[key] || []), ...(second.delete?.[key] || [])])];
        for (const id of deleted) items.delete(id);
        if (items.size) result.upsert![key] = [...items.values()];
        if (deleted.length) result.delete![key] = deleted;
    }
    return result;
}
const hasPatch = (patch: CanvasPatch) => Object.values(patch.set || {}).length + Object.values(patch.upsert || {}).flat().length + Object.values(patch.delete || {}).flat().length > 0;

type Callbacks = {
    get: () => Data;
    apply: (data: Data, reset: boolean) => void;
    status: (state: { disconnected: boolean; canEdit: boolean; online: CanvasPresence[]; pending: boolean; error?: string }) => void;
    selected: () => string[];
    denied: () => void;
};
// The read cursor advances only after pulling changes, never after posting a patch:
// a successful write may have other members' revisions immediately before it.
export class TeamCanvasSync {
    private revision: number;
    private rendered: Data;
    private pending: CanvasPatch = {};
    private inFlight: CanvasPatch = {};
    private posting: CanvasPatch | null = null;
    private observedWriteRevision: number | null = null;
    private acknowledged: { revision: number; patch: CanvasPatch }[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private polling: ReturnType<typeof setInterval> | null = null;
    private pulling = false;
    private sending = false;
    private stopped = false;
    private epoch = 0;
    private locks = new Map<string, { fields: Set<string>; touched: Set<string> }>();
    private deferred: CanvasPatch = {};
    private state = { disconnected: false, canEdit: true, online: [] as CanvasPresence[], pending: false, error: undefined as string | undefined };
    constructor(private token: string, private id: string, private userId: string, snapshot: CanvasSnapshot, private callbacks: Callbacks) {
        this.revision = snapshot.revision;
        this.rendered = sharedCanvasData(snapshot.project_data);
        this.state.canEdit = snapshot.can_edit;
    }
    start() {
        this.report();
        void this.pull();
        this.polling = setInterval(() => void this.pull(), 1500);
        window.addEventListener("online", this.reconnect);
        window.addEventListener("offline", this.offline);
    }
    private reconnect = () => { void this.pull(); };
    private offline = () => { this.state.disconnected = true; this.report(); };
    private report() {
        if (this.stopped) return;
        this.state.pending = hasPatch(this.pending) || this.sending;
        this.callbacks.status({ ...this.state });
    }
    observe(data: Data) {
        if (this.stopped || !this.state.canEdit) return;
        const patch = diffCanvasData(this.rendered, data);
        if (!hasPatch(patch)) return;
        for (const item of patch.upsert?.nodes || []) {
            const lock = this.locks.get(item.id);
            if (lock) Object.keys(item).filter((key) => lock.fields.has(key)).forEach((key) => lock.touched.add(key));
        }
        this.pending = mergePatches(this.pending, patch);
        this.rendered = data;
        this.schedule();
    }
    lock(ids: string[], fields: string[]) {
        for (const id of ids) {
            const previous = this.locks.get(id);
            this.locks.set(id, { fields: new Set([...(previous?.fields || []), ...fields]), touched: previous?.touched || new Set() });
        }
    }
    unlock() {
        if (!this.locks.size || this.stopped) return;
        this.observe(this.callbacks.get());
        const keep: CanvasPatch = {};
        for (const [id, lock] of this.locks) {
            const item = (this.rendered.nodes as Item[]).find((node) => node.id === id);
            if (!item || !lock.touched.size) continue;
            (keep.upsert ||= {}).nodes ||= [];
            keep.upsert.nodes.push({ id, ...Object.fromEntries([...lock.touched].map((key) => [key, item[key]])) });
        }
        this.locks.clear();
        this.rendered = applyCanvasPatch(applyCanvasPatch(this.rendered, this.deferred), keep);
        this.deferred = {};
        this.pending = mergePatches(this.pending, keep);
        this.callbacks.apply(this.rendered, false);
        this.schedule();
    }
    private schedule() {
        if (!this.timer && hasPatch(this.pending)) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 300);
        this.report();
    }
    private async failure(error: unknown) {
        if (this.stopped) return;
        if (error instanceof CanvasCollabError && error.status === 404) { this.callbacks.denied(); this.stop(); return; }
        if (error instanceof CanvasCollabError && error.status === 403) {
            this.state.canEdit = false;
            this.pending = {}; this.inFlight = {}; this.acknowledged = []; this.locks.clear(); this.deferred = {};
            this.report();
            try { this.reset(await getCanvasSnapshot(this.token, this.id)); } catch (next) { await this.failure(next); }
            return;
        }
        this.state.disconnected = true;
        this.state.error = error instanceof Error ? error.message : "画布同步失败";
        this.report();
    }
    private reset(snapshot: CanvasSnapshot) {
        this.epoch++;
        this.posting = null; this.observedWriteRevision = null;
        this.pending = {}; this.inFlight = {}; this.acknowledged = []; this.deferred = {}; this.locks.clear();
        this.revision = snapshot.revision;
        this.state.canEdit = snapshot.can_edit;
        this.rendered = sharedCanvasData(snapshot.project_data);
        this.callbacks.apply(this.rendered, true);
    }
    private async flush() {
        if (this.stopped || this.sending || !this.state.canEdit || !hasPatch(this.pending)) return;
        this.sending = true;
        this.posting = null; this.observedWriteRevision = null;
        const epoch = this.epoch;
        const sent = this.pending;
        this.inFlight = sent; this.pending = {};
        this.report();
        try {
            const uploadInput = structuredClone(sent);
            // Sparse upserts lack the node type; supply it only while preparing media.
            for (const item of uploadInput.upsert?.nodes || []) {
                const node = (this.rendered.nodes as Item[]).find((node) => node.id === item.id);
                if (node && !item.type) item.type = node.type;
            }
            const prepared = await syncMediaReferences(uploadInput, this.token, true);
            for (const item of prepared.upsert?.nodes || []) {
                if (!sent.upsert?.nodes?.find((original) => original.id === item.id)?.type) delete item.type;
            }
            if (this.stopped || epoch !== this.epoch || !this.state.canEdit) return;
            this.posting = prepared;
            const saved = await postCanvasPatch(this.token, this.id, this.revision, prepared);
            if (this.stopped || epoch !== this.epoch) return;
            // Keep a write mask until the polling cursor passes the write. An older
            // foreign patch must not overwrite this write just because its echo is skipped.
            if (saved.revision > this.revision) this.acknowledged.push({ revision: saved.revision, patch: prepared });
            this.observe(this.callbacks.get());
            // Replace local media URLs only where the field hasn't since been edited.
            const safe: CanvasPatch = {};
            for (const [key, items] of Object.entries(prepared.upsert || {})) {
                for (const item of items) {
                    const original = sent.upsert?.[key]?.find((old) => old.id === item.id);
                    const current = (this.rendered[key] as Item[] || []).find((old) => old.id === item.id);
                    if (!current || !original) continue;
                    const fields = Object.fromEntries(Object.entries(item).filter(([field, value]) => field !== "id" && !equal(value, original[field]) && equal(current[field], original[field])));
                    if (Object.keys(fields).length) ((safe.upsert ||= {})[key] ||= []).push({ id: item.id, ...fields });
                }
            }
            if (hasPatch(safe)) { this.rendered = applyCanvasPatch(this.rendered, safe); this.callbacks.apply(this.rendered, false); }
            this.state.disconnected = false; this.state.error = undefined;
        } catch (error) {
            if (!this.stopped && epoch === this.epoch) { this.pending = mergePatches(sent, this.pending); await this.failure(error); }
        } finally {
            this.sending = false; this.inFlight = {}; this.posting = null; this.observedWriteRevision = null;
            this.report();
            if (!this.state.disconnected) this.schedule();
        }
    }
    private async pull() {
        if (this.stopped || this.pulling) return;
        this.pulling = true;
        try {
            const result = await getCanvasChanges(this.token, this.id, this.revision, this.callbacks.selected());
            if (this.stopped) return;
            this.observe(this.callbacks.get());
            if (!result.can_edit && this.state.canEdit) {
                this.state.canEdit = false; this.report();
                this.reset(await getCanvasSnapshot(this.token, this.id));
            } else if (result.reset) this.reset(result);
            else {
                this.state.canEdit = result.can_edit;
                let changed = false;
                for (const change of result.changes || []) {
                    if (change.user_id === this.userId) {
                        if (this.posting && samePatch(change.patch, this.posting)) this.observedWriteRevision = change.revision;
                        continue;
                    }
                    changed = true;
                    const patch = structuredClone(change.patch);
                    // A remote deletion wins over queued updates (server tombstones).
                    for (const [key, ids] of Object.entries(patch.delete || {})) {
                        if (key === "nodes") {
                            for (const id of ids) this.locks.delete(id);
                            if (this.deferred.upsert?.nodes) this.deferred.upsert.nodes = this.deferred.upsert.nodes.filter((item) => !ids.includes(item.id));
                        }
                        for (const local of [this.pending, this.inFlight, ...this.acknowledged.map((entry) => entry.patch)]) if (local.upsert?.[key]) local.upsert[key] = local.upsert[key].filter((item) => !ids.includes(item.id));
                    }
                    for (const item of patch.upsert?.nodes || []) {
                        const lock = this.locks.get(item.id);
                        if (!lock) continue;
                        const fields = Object.fromEntries(Object.entries(item).filter(([key]) => lock.fields.has(key)));
                        if (Object.keys(fields).length) this.deferred = mergePatches(this.deferred, { upsert: { nodes: [{ id: item.id, ...fields }] } });
                        for (const key of lock.fields) delete item[key];
                    }
                    let merged = applyCanvasPatch(this.rendered, patch);
                    for (const entry of this.acknowledged) if (entry.revision > change.revision) merged = applyCanvasPatch(merged, entry.patch);
                    if (this.observedWriteRevision === null || change.revision < this.observedWriteRevision) merged = applyCanvasPatch(merged, this.inFlight);
                    this.rendered = applyCanvasPatch(merged, this.pending);
                }
                this.revision = result.revision;
                this.acknowledged = this.acknowledged.filter((entry) => entry.revision > this.revision);
                if (changed) this.callbacks.apply(this.rendered, false);
            }
            this.state.online = result.online || [];
            this.state.disconnected = false; this.state.error = undefined;
            this.schedule();
        } catch (error) { await this.failure(error); }
        finally { this.pulling = false; }
    }
    stop() {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        if (this.polling) clearInterval(this.polling);
        window.removeEventListener("online", this.reconnect);
        window.removeEventListener("offline", this.offline);
    }
}

const memberColors = ["var(--t-script)", "var(--t-image)", "var(--t-video)", "var(--t-audio)", "var(--t-character)", "var(--ok)"];
export function teamMemberColor(id: string) {
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return memberColors[hash % memberColors.length];
}
