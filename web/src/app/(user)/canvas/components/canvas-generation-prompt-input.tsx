"use client";

import { imagePreviewUrl } from "@/services/image-storage";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Music2 } from "lucide-react";
import { materialId, materialToken, materialTokenPattern, type GenerationReference } from "../utils/canvas-generation-references";

type Props = {
    value: string;
    references: GenerationReference[];
    onChange: (value: string) => void;
    onSubmit?: (value: string) => void;
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
    readOnly?: boolean;
};
type Mention = { query: string; range: Range; left: number; top: number };
const kindNames = { image: "图片", video: "视频", audio: "音频" };

export function CanvasGenerationPromptInput({ value, references, onChange, onSubmit, className, style, placeholder, readOnly = false }: Props) {
    const editorRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const lastValue = useRef<string | null>(null);
    const composing = useRef(false);
    const [mention, setMention] = useState<Mention | null>(null);
    const [active, setActive] = useState(0);
    const menuId = useId();
    const candidates = useMemo(() => (["image", "video", "audio"] as const).flatMap((kind) => references.filter((reference) => reference.kind === kind && reference.label.includes(mention?.query || ""))), [references, mention?.query]);
    const activeIndex = Math.min(active, Math.max(0, candidates.length - 1));

    const emit = () => {
        if (!editorRef.current) return;
        const next = serialize(editorRef.current);
        lastValue.current = next;
        onChange(next);
    };

    useLayoutEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const byId = new Map(references.map((reference) => [reference.id, reference]));
        if (lastValue.current !== value) {
            setMention(null);
            const focused = document.activeElement === editor;
            const caretOffset = focused ? getCaretOffset(editor) : null;
            editor.replaceChildren();
            let offset = 0;
            for (const match of value.matchAll(materialTokenPattern)) {
                editor.append(document.createTextNode(value.slice(offset, match.index)));
                const reference = byId.get(materialId(match[1]));
                if (reference) editor.append(createChip(reference));
                offset = (match.index || 0) + match[0].length;
            }
            editor.append(document.createTextNode(value.slice(offset)));
            if (focused && caretOffset !== null) setCaretAtOffset(editor, caretOffset);
            lastValue.current = value;
        } else {
            // 改号只更新标签内部，保留用户正在编辑的文字与光标。
            editor.querySelectorAll<HTMLElement>("[data-material-id]").forEach((chip) => {
                const reference = byId.get(chip.dataset.materialId || "");
                if (!reference) chip.remove();
                else updateChip(chip, reference);
            });
        }
    }, [value, references]);

    useEffect(() => {
        if (!mention) return;
        const closeOutside = (event: globalThis.PointerEvent) => {
            if (!editorRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setMention(null);
        };
        const close = (event: Event) => { if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) setMention(null); };
        document.addEventListener("pointerdown", closeOutside, true);
        window.addEventListener("resize", close);
        window.addEventListener("scroll", close, true);
        return () => {
            document.removeEventListener("pointerdown", closeOutside, true);
            window.removeEventListener("resize", close);
            window.removeEventListener("scroll", close, true);
        };
    }, [Boolean(mention)]);

    useEffect(() => {
        menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    const syncMention = () => {
        const selection = window.getSelection();
        if (!selection?.rangeCount || !selection.isCollapsed) return setMention(null);
        const range = selection.getRangeAt(0);
        if (!editorRef.current?.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE) return setMention(null);
        const before = (range.startContainer.textContent || "").slice(0, range.startOffset);
        const match = /@([^\s@]*)$/.exec(before);
        if (!match) return setMention(null);
        const replacement = range.cloneRange();
        replacement.setStart(range.startContainer, range.startOffset - match[0].length);
        const anchor = range.cloneRange();
        if (anchor.startOffset > 0) anchor.setStart(anchor.startContainer, anchor.startOffset - 1);
        const rect = anchor.getBoundingClientRect();
        setMention({ query: match[1], range: replacement, left: rect.right, top: rect.bottom + 6 });
        setActive(0);
    };

    const insert = (reference: GenerationReference) => {
        const editor = editorRef.current;
        if (!mention || !editor || !editor.contains(mention.range.startContainer)) return;
        const range = mention.range;
        range.deleteContents();
        const chip = createChip(reference);
        range.insertNode(chip);
        const spacer = document.createTextNode("\uFEFF");
        chip.after(spacer);
        range.setStart(spacer, 1);
        range.collapse(true);
        editor.focus();
        setCaret(range);
        setMention(null);
        emit();
    };

    return <div className="relative w-full">
        {!value && placeholder ? <div className="pointer-events-none absolute left-3 top-2 text-sm leading-5" style={{ color: "var(--muted)" }}>{placeholder}</div> : null}
        <div ref={editorRef} contentEditable={!readOnly} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-readonly={readOnly || undefined} aria-label={readOnly ? "提示词（只读）" : "生成提示词"} aria-autocomplete={readOnly ? undefined : "list"} aria-expanded={readOnly ? undefined : Boolean(mention)} aria-controls={readOnly || !mention ? undefined : menuId} aria-activedescendant={readOnly || !mention || !candidates[activeIndex] ? undefined : `${menuId}-${activeIndex}`}
            className={`${className || ""} ${readOnly ? "cursor-text select-text" : "cursor-text"} overflow-y-auto whitespace-pre-wrap break-words outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`} style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onInput={() => { if (!readOnly && !composing.current) { emit(); syncMention(); } }}
            onCompositionStart={() => { if (!readOnly) { composing.current = true; setMention(null); } }}
            onCompositionEnd={() => { if (!readOnly) { composing.current = false; emit(); syncMention(); } }}
            onBlur={() => setMention(null)}
            onPointerUp={readOnly ? undefined : syncMention}
            onPaste={(event) => {
                if (readOnly) return;
                event.preventDefault();
                const selection = window.getSelection();
                if (!selection?.rangeCount) return;
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const text = document.createTextNode(event.clipboardData.getData("text/plain"));
                range.insertNode(text);
                range.setStartAfter(text);
                range.collapse(true);
                setCaret(range);
                emit(); syncMention();
            }}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (readOnly) return;
                if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (mention) {
                    if (event.key === "Escape") { event.preventDefault(); setMention(null); return; }
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        if (candidates.length) setActive((Math.min(active, candidates.length - 1) + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length);
                        return;
                    }
                    if (event.key === "Enter") { event.preventDefault(); if (candidates[activeIndex]) insert(candidates[activeIndex]); return; }
                }
                if ((event.key === "Backspace" || event.key === "Delete") && deleteChip(editorRef.current, event.key === "Backspace")) {
                    event.preventDefault(); emit(); setMention(null); return;
                }
                if (event.key === "Enter" && !event.shiftKey && onSubmit) { event.preventDefault(); onSubmit(serialize(event.currentTarget)); return; }
                if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") requestAnimationFrame(syncMention);
            }} />
        {mention ? createPortal(<div ref={menuRef} id={menuId} role="listbox" aria-label="待引用素材" data-canvas-no-zoom
            className="fixed z-[1200] max-h-64 w-64 overflow-y-auto rounded-[14px] border p-1 shadow-2xl" style={{ left: Math.max(8, Math.min(mention.left, window.innerWidth - 264)), top: Math.max(8, Math.min(mention.top, window.innerHeight - Math.min(256, candidates.length * 44 + 80) - 8)), background: "var(--raised)", borderColor: "var(--line)", color: "var(--text)" }}
            onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onMouseDown={(event) => event.preventDefault()} onWheel={(event) => event.stopPropagation()}>
            {!candidates.length ? <p className="m-0 p-3 text-xs leading-5" style={{ color: "var(--muted)" }}>{references.length ? "没有匹配的素材" : "还没有待引用素材：点 + 上传，或把上游节点连进来"}</p> : candidates.map((reference, index) => <div key={reference.id}>
                {index === 0 || reference.kind !== candidates[index - 1].kind ? <div className="px-2 pb-1 pt-2 text-[11px]" style={{ color: "var(--muted)" }}>{kindNames[reference.kind]}</div> : null}
                <button type="button" role="option" aria-selected={activeIndex === index} id={`${menuId}-${index}`} data-option-index={index} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs" style={{ background: activeIndex === index ? "var(--hover)" : "transparent" }} onPointerMove={() => setActive(index)} onClick={(event) => { event.stopPropagation(); insert(reference); }}>
                    <MaterialThumbnail reference={reference} className="size-8 shrink-0 rounded object-cover" />{reference.label}
                </button>
            </div>)}
        </div>, document.body) : null}
    </div>;
}

export function MaterialThumbnail({ reference, className }: { reference: GenerationReference; className?: string }) {
    if (reference.kind === "image") return <img decoding="async" loading="lazy" src={imagePreviewUrl(reference.previewUrl || "")} alt="" className={className} />;
    if (reference.kind === "video") return <video src={reference.previewUrl} muted playsInline preload="metadata" className={className} />;
    return <span className={`grid place-items-center ${className || ""}`} style={{ background: "var(--hover)", color: "var(--t-audio)" }}><Music2 className="size-4" /></span>;
}

function createChip(reference: GenerationReference) {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.materialId = reference.id;
    chip.className = "mx-px inline-flex h-[22px] items-center gap-1 rounded px-1 text-xs align-middle select-none";
    chip.style.background = "var(--raised)";
    chip.style.color = "var(--text)";
    updateChip(chip, reference);
    return chip;
}

function updateChip(chip: HTMLElement, reference: GenerationReference) {
    if (chip.dataset.label === reference.label && chip.dataset.url === reference.previewUrl) return;
    chip.dataset.label = reference.label;
    chip.dataset.url = reference.previewUrl;
    chip.title = reference.label;
    chip.replaceChildren();
    if (reference.kind === "image" || reference.kind === "video") {
        const media = document.createElement(reference.kind === "image" ? "img" : "video");
        media.src = reference.previewUrl || "";
        media.className = "size-4 shrink-0 rounded object-cover";
        if (media instanceof HTMLVideoElement) { media.muted = true; media.preload = "metadata"; }
        chip.append(media);
    } else {
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("fill", "none"); icon.setAttribute("stroke", "var(--t-audio)"); icon.setAttribute("stroke-width", "1.75"); icon.setAttribute("width", "16"); icon.setAttribute("height", "16");
        const path = document.createElementNS(icon.namespaceURI, "path");
        path.setAttribute("d", "M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm12-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z");
        icon.append(path); chip.append(icon);
    }
    chip.append(document.createTextNode(reference.label));
}

function serialize(editor: HTMLElement): string {
    if (editor.childNodes.length === 1 && editor.firstChild instanceof HTMLBRElement) return "";
    const state = { text: "", emptyLine: true, pendingBr: false };
    function read(nodes: NodeListOf<ChildNode>, group = { hasContent: false, afterBlock: false }) {
        nodes.forEach((node) => {
            const element = node instanceof HTMLElement ? node : null;
            const text = node.nodeType === Node.TEXT_NODE ? node.textContent || "" : element?.dataset.materialId ? materialToken(element.dataset.materialId) : "";
            const block = element?.tagName === "DIV" || element?.tagName === "P";
            const br = element?.tagName === "BR";
            if (!text && !block && !br) { if (element) read(element.childNodes, group); return; }
            if (block || group.afterBlock) {
                if (group.hasContent && (state.emptyLine || !state.text.endsWith("\n"))) state.text += "\n";
                state.pendingBr = false; state.emptyLine = true; group.afterBlock = false;
            }
            if (block) {
                read(element!.childNodes);
                state.pendingBr = false; group.afterBlock = true;
            } else {
                if (state.pendingBr) { state.text += "\n"; state.emptyLine = true; }
                state.pendingBr = br;
                if (text) { state.text += text; state.emptyLine = false; }
            }
            group.hasContent = true;
        });
    }
    read(editor.childNodes);
    return state.text.replace(/\uFEFF/g, "");
}

function setCaret(range: Range) {
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
}

function getCaretOffset(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return null;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(selection.anchorNode!, selection.anchorOffset);
    return range.toString().length;
}

function setCaretAtOffset(editor: HTMLElement, offset: number) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode();
    while (node) {
        const length = node.textContent?.length || 0;
        if (remaining <= length) {
            const range = document.createRange();
            range.setStart(node, remaining);
            range.collapse(true);
            editor.focus();
            setCaret(range);
            return;
        }
        remaining -= length;
        node = walker.nextNode();
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    setCaret(range);
}

function deleteChip(editor: HTMLElement | null, backward: boolean) {
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const container = range.startContainer;
    let target: Node | null;
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((backward ? text.slice(0, range.startOffset) : text.slice(range.startOffset)).replace(/\uFEFF/g, "")) return false;
        target = backward ? container.previousSibling : container.nextSibling;
    } else target = container.childNodes[backward ? range.startOffset - 1 : range.startOffset] || null;
    while (target?.nodeType === Node.TEXT_NODE && !(target.textContent || "").replace(/\uFEFF/g, "")) target = backward ? target.previousSibling : target.nextSibling;
    if (!(target instanceof HTMLElement) || !target.dataset.materialId || !editor.contains(target)) return false;
    const spacer = document.createTextNode("\uFEFF");
    target.replaceWith(spacer);
    range.setStart(spacer, 1); range.collapse(true); setCaret(range);
    return true;
}
