import type { CameraMotionOptions } from "../types";

export type CameraMotionPreset = {
    id: string;
    name: string;
    group: "基础" | "电影感";
    description: string;
    promptZh: string;
    promptEn: string;
    animation: string;
};

export const CAMERA_MOTION_PRESETS: CameraMotionPreset[] = [
    { id: "static", name: "固定", group: "基础", description: "片场保持静止，右下角锁图标表示固定机位。", promptZh: "固定机位，镜头不动", promptEn: "static camera, locked-off shot", animation: "static" },
    { id: "push-in", name: "推近", group: "基础", description: "场景由远及近，缓慢推向主体。", promptZh: "镜头缓慢向前推近主体", promptEn: "slow push-in toward the subject", animation: "push" },
    { id: "pull-out", name: "拉远", group: "基础", description: "场景逐渐缩小，镜头缓慢后退。", promptZh: "镜头缓慢向后拉远", promptEn: "slow pull-out, dolly out", animation: "pull" },
    { id: "pan-left", name: "左摇", group: "基础", description: "片场向右转动，表现镜头向左摇。", promptZh: "镜头向左摇", promptEn: "camera pans left", animation: "pan-left" },
    { id: "pan-right", name: "右摇", group: "基础", description: "片场向左转动，表现镜头向右摇。", promptZh: "镜头向右摇", promptEn: "camera pans right", animation: "pan-right" },
    { id: "tilt-up", name: "上摇", group: "基础", description: "片场沿水平轴向下转动，表现镜头向上摇。", promptZh: "镜头向上摇", promptEn: "camera tilts up", animation: "tilt-up" },
    { id: "tilt-down", name: "下摇", group: "基础", description: "片场沿水平轴向上转动，表现镜头向下摇。", promptZh: "镜头向下摇", promptEn: "camera tilts down", animation: "tilt-down" },
    { id: "truck-left", name: "左移", group: "基础", description: "片场向右横移，主体比地面网格多移四成，表现镜头左移。", promptZh: "镜头向左横移", promptEn: "camera trucks left, lateral tracking", animation: "truck-left" },
    { id: "truck-right", name: "右移", group: "基础", description: "片场向左横移，主体比地面网格多移四成，表现镜头右移。", promptZh: "镜头向右横移", promptEn: "camera trucks right, lateral tracking", animation: "truck-right" },
    { id: "crane-up", name: "升镜", group: "基础", description: "片场下移并改变俯视角度，模拟镜头升起。", promptZh: "镜头缓慢升起", promptEn: "crane up, rising camera", animation: "crane-up" },
    { id: "crane-down", name: "降镜", group: "基础", description: "片场上移并恢复平视角度，模拟镜头下降。", promptZh: "镜头缓慢下降", promptEn: "crane down, descending camera", animation: "crane-down" },
    { id: "tracking", name: "跟拍", group: "基础", description: "主体原地轻微起伏，地面横线向后流动。", promptZh: "镜头跟随主体移动", promptEn: "tracking shot following the subject", animation: "tracking" },
    { id: "orbit", name: "环绕", group: "基础", description: "片场沿竖直轴连续旋转一周，表现镜头环绕主体。", promptZh: "镜头围绕主体环绕", promptEn: "orbit shot circling around the subject", animation: "orbit" },
    { id: "handheld", name: "手持", group: "基础", description: "场景轻微不规则抖动。", promptZh: "手持拍摄，轻微晃动", promptEn: "handheld camera, subtle shake", animation: "handheld" },
    { id: "dolly-zoom", name: "希区柯克变焦", group: "电影感", description: "主体尺寸稳定，地面网格产生变焦拉伸。", promptZh: "希区柯克变焦，主体大小不变、背景压缩拉伸", promptEn: "dolly zoom, vertigo effect", animation: "dolly-zoom" },
    { id: "whip-pan", name: "快速甩镜", group: "电影感", description: "场景快速横甩并带有轻微动态模糊。", promptZh: "快速甩镜转场", promptEn: "whip pan, fast swish", animation: "whip-pan" },
    { id: "aerial-dive", name: "航拍俯冲", group: "电影感", description: "片场从高空俯视的小景逐渐放大，向主体俯冲。", promptZh: "航拍俯冲向主体", promptEn: "aerial drone dive toward the subject", animation: "aerial-dive" },
    { id: "pov", name: "第一人称", group: "电影感", description: "地面横线持续向镜头流动，片场轻微上下起伏。", promptZh: "第一人称视角向前移动", promptEn: "first-person POV moving forward", animation: "pov" },
    { id: "roll-360", name: "360°旋转", group: "电影感", description: "场景在画框内完整旋转一周。", promptZh: "镜头 360 度旋转", promptEn: "camera rolls 360 degrees", animation: "roll" },
];

export function applyCameraMotionPrompt(prompt: string, motion?: CameraMotionOptions): string {
    if (!motion?.enabled) return prompt;
    const preset = CAMERA_MOTION_PRESETS.find((item) => item.id === motion.preset);
    if (!preset) return prompt;
    const zh = motion.intensity === "light" ? `轻微、缓慢的${preset.promptZh}` : motion.intensity === "strong" ? `明显、快速的${preset.promptZh}` : preset.promptZh;
    const en = motion.intensity === "light" ? `subtle, slow ${preset.promptEn}` : motion.intensity === "strong" ? `dramatic, fast ${preset.promptEn}` : preset.promptEn;
    return `${prompt}${prompt ? "\n" : ""}运镜：${zh}（${motion.intensity === "light" ? "轻" : motion.intensity === "strong" ? "强" : "中"}）。Camera: ${en}`;
}
