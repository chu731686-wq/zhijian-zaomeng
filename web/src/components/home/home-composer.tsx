"use client";

import { useEffect, useState } from "react";
import { App, Dropdown, Popover } from "antd";
import { ArrowRight, ChevronDown, FolderOpen, LoaderCircle, Upload, Wrench } from "lucide-react";
import { CanvasPromptChipInput } from "@/app/(user)/canvas/components/canvas-prompt-chip-input";
import { assistantToPromptReference, type CanvasAssistantComposerProps } from "@/app/(user)/canvas/components/canvas-assistant-composer";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";

export type HomeComposerProps = CanvasAssistantComposerProps & {
    onBlank: () => void;
    submitting: boolean;
    ratio: "9:16" | "16:9";
    onRatioChange: (ratio: "9:16" | "16:9") => void;
    style: string;
    onStyleChange: (style: string) => void;
};

export function HomeComposer(props: HomeComposerProps) {
    const { message } = App.useApp();
    const [skillsOpen, setSkillsOpen] = useState(false);
    const systemSkills = useAgentSkillStore((s) => s.systemSkills);
    const userSkills = useAgentSkillStore((s) => s.userSkills);
    const isLoading = useAgentSkillStore((s) => s.isLoading);
    const loadSkills = useAgentSkillStore((s) => s.loadSkills);
    useEffect(() => {
        if (skillsOpen) void loadSkills().catch(() => message.info("技能暂时不可用，可直接描述创作目标"));
    }, [skillsOpen, loadSkills, message]);
    const skills = [...systemSkills, ...userSkills];
    const skillContent = (
        <div className="home-skill-list">
            <strong>选择创作技能</strong>
            {isLoading ? (
                <p>
                    <LoaderCircle className="studio-spin" />
                    正在加载…
                </p>
            ) : skills.length ? (
                skills.map((skill) => (
                    <button
                        key={`${skill.source}-${skill.id}`}
                        type="button"
                        onClick={() => {
                            props.onSkillSelect?.({ id: skill.id, name: skill.name, source: skill.source });
                            props.onPromptChange(props.prompt.replace(/(?:^|\s)\/[^\s]*$/, " "));
                            setSkillsOpen(false);
                        }}
                    >
                        <Wrench />
                        <span>
                            {skill.name}
                            <small>{skill.description}</small>
                        </span>
                    </button>
                ))
            ) : (
                <p>技能即将上线，可先描述故事</p>
            )}
        </div>
    );
    return (
        <section className="home-creation" aria-labelledby="creation-title">
            <div className="home-hero-art">
                <img src="/samples/home-hero.png" alt="雨夜古城中的原创漫剧人物静帧" fetchPriority="high" />
            </div>
            <div className="home-creation-content">
                <p className="home-eyebrow">创作工作室</p>
                <h1 id="creation-title">今天想拍一部什么样的漫剧？</h1>
                <p className="home-creation-description">从一个念头到一部漫剧，让助手陪你把故事变成画面。</p>
                <div className="home-prompt-box">
                    <CanvasPromptChipInput
                        value={props.prompt}
                        references={props.references.map(assistantToPromptReference)}
                        skills={props.selectedSkills}
                        onSkillRemove={props.onSkillRemove}
                        onChange={(value) => {
                            props.onPromptChange(value);
                            if (/(?:^|\s)\/[^\s]*$/.test(value)) setSkillsOpen(true);
                        }}
                        onReferenceIdsChange={props.onReferenceIdsChange}
                        onPasteImage={props.onPasteImage}
                        onSubmit={props.onSubmit}
                        className="home-prompt-editor thin-scrollbar"
                        style={{ color: "var(--text)" }}
                        placeholder="写下故事、贴一段小说，或上传剧本……  输入 / 选择技能，@ 引用素材"
                        placeholderClassName="home-prompt-placeholder"
                    />
                    <div className="home-prompt-tools">
                        <Popover trigger="click" open={skillsOpen} onOpenChange={setSkillsOpen} content={skillContent}>
                            <button type="button" className="studio-icon-button" aria-label="选择技能" title="选择技能">
                                <Wrench />
                            </button>
                        </Popover>
                        <button type="button" className="studio-icon-button" onClick={props.onOpenAssets} aria-label="引用素材" title="引用素材">
                            <FolderOpen />
                        </button>
                    </div>
                </div>
                <div className="home-composer-footer">
                    <div className="home-composer-options">
                        <button type="button" className="home-pill" onClick={props.onOpenUpload} title="支持 TXT、Markdown 剧本，也可上传图片、视频和音频">
                            <Upload />
                            上传剧本
                        </button>
                        <div className="home-ratio" role="group" aria-label="画幅">
                            {(["9:16", "16:9"] as const).map((ratio) => (
                                <button key={ratio} type="button" aria-pressed={props.ratio === ratio} className={props.ratio === ratio ? "is-selected" : ""} onClick={() => props.onRatioChange(ratio)}>
                                    {ratio}
                                </button>
                            ))}
                        </div>
                        <Dropdown trigger={["click"]} menu={{ selectedKeys: [props.style], items: ["默认风格", "国风漫剧", "都市漫剧", "科幻漫剧"].map((label) => ({ key: label, label, onClick: () => props.onStyleChange(label) })) }}>
                            <button type="button" className="home-pill" aria-label="选择风格">
                                {props.style === "默认风格" ? "风格" : props.style}
                                <ChevronDown />
                            </button>
                        </Dropdown>
                    </div>
                    <div className="home-composer-actions">
                        <button type="button" className="studio-button" onClick={props.onBlank}>
                            空白画布
                        </button>
                        <span title={!props.prompt.trim() ? "先写一句想法，或选一个模板" : undefined}>
                            <button type="button" className="studio-button is-primary" disabled={!props.prompt.trim() || props.submitting} onClick={() => props.onSubmit()}>
                                {props.submitting ? <LoaderCircle className="studio-spin" /> : null}交给助手
                                <ArrowRight />
                            </button>
                        </span>
                    </div>
                </div>
                {!props.prompt.trim() && <p className="home-input-hint">先写一句想法，或选一个模板</p>}
            </div>
        </section>
    );
}
