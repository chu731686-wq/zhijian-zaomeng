export type LinkedText = { nodeId: string; text: string };

function findLinkedTextIndex(prompt: string, text: string) {
    let index = prompt.lastIndexOf(text);
    while (index >= 0) {
        const nextCharacter = prompt[index + text.length];
        const characterAfterNext = prompt[index + text.length + 1];
        const hasSingleCharacterEdit =
            nextCharacter &&
            /[\u4e00-\u9fff]/.test(nextCharacter) &&
            (!characterAfterNext || characterAfterNext === "\n");
        if (!hasSingleCharacterEdit) return index;
        index = prompt.lastIndexOf(text, index - 1);
    }
    return -1;
}

export function syncLinkedTextPrompt(prompt: string, linkedTexts: LinkedText[], sources: LinkedText[]) {
    const applied = sources
        .filter((source) => source.text.trim())
        .map((source) => ({ ...source, text: source.text.trim() }));

    if (
        applied.length === linkedTexts.length &&
        applied.every((source, index) => {
            const linked = linkedTexts[index];
            return source.nodeId === linked.nodeId && source.text === linked.text;
        })
    ) {
        return { prompt, applied: linkedTexts };
    }

    let nextPrompt = prompt;
    const toAppend = new Set<string>();

    for (const linked of [...linkedTexts].reverse()) {
        const source = applied.find((item) => item.nodeId === linked.nodeId);
        if (source && source.text === linked.text) continue;
        if (!linked.text) continue;

        const index = findLinkedTextIndex(nextPrompt, linked.text);
        if (index < 0) continue;

        const start = index > 0 && nextPrompt[index - 1] === "\n" ? index - 1 : index;
        nextPrompt = `${nextPrompt.slice(0, start)}${nextPrompt.slice(index + linked.text.length)}`;
        if (source) toAppend.add(source.nodeId);
    }

    nextPrompt = nextPrompt.trimEnd();
    for (const source of applied) {
        const linked = linkedTexts.find((item) => item.nodeId === source.nodeId);
        if (linked && !toAppend.has(source.nodeId)) continue;
        nextPrompt = nextPrompt ? `${nextPrompt}\n${source.text}` : source.text;
    }

    return { prompt: nextPrompt, applied };
}
