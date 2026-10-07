const MANJU_VIDEO_SECTIONS = [
    "【精准主体】",
    "【整片质感】",
    "【核心剧情】",
    "【补充光影】",
    "【防崩约束】",
] as const;

export function checkManjuVideoPrompt(prompt: string): { ok: true } | { ok: false; missing: string[]; message: string } {
    const sections = MANJU_VIDEO_SECTIONS.map((title) => {
        const index = prompt.indexOf(title);
        return { title, index };
    });
    const missing = sections
        .filter(({ title, index }) => {
            if (index < 0) return true;
            const end = sections
                .map((section) => section.index)
                .filter((nextIndex) => nextIndex > index)
                .sort((a, b) => a - b)[0] ?? prompt.length;
            return !prompt.slice(index + title.length, end).trim();
        })
        .map(({ title }) => title);

    const allPresent = sections.every(({ index }) => index >= 0);
    const outOfOrder = allPresent && sections.some((section, index) =>
        index > 0 && section.index < sections[index - 1].index,
    );

    if (!missing.length && !outOfOrder) return { ok: true };

    const issue = [
        ...(missing.length ? [`缺少或内容为空的栏目：${missing.join("、")}`] : []),
        ...(outOfOrder ? ["五栏顺序不正确"] : []),
    ].join("；");
    return {
        ok: false,
        missing,
        message: `视频提示词格式不合格，${issue}。请先用 read_skill_file 读取 references/输出格式-常规模型.md（Seedance 2.5 读取 references/输出格式-Seedance2.5.md），【整片质感】完整复制全片质感节点基底原文，【防崩约束】复制对应原文，按五栏重写后重新调用 generate_video。`,
    };
}
