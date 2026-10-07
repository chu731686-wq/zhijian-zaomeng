export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasGroupColors = {
    人物: "#E0703C",
    场景: "#3BA776",
    道具: "#4C8DE0",
    分集: "#8B7BE8",
    其他: "#8A8A92",
} as const;

// Both legacy theme keys use the studio palette; components consume semantic tokens.
const studioTheme = {
    canvas: {
        background: "var(--bg)",
        dot: "rgb(from var(--hover) calc(r - 2) calc(g - 2) calc(b - 2))",
        line: "var(--line)",
        selectionStroke: "var(--accent)", selectionFill: "var(--accent-soft)",
    },
    node: {
        label: "var(--muted)", fill: "var(--raised)", panel: "var(--surface)",
        stroke: "var(--line)", hoverStroke: "var(--line-strong)", activeStroke: "var(--accent)",
        placeholder: "var(--muted)", text: "var(--text)", muted: "var(--muted)", faint: "var(--subtle)",
        preview: "rgb(from var(--bg) calc(r - 4) calc(g - 4) calc(b - 4))",
    },
    toolbar: {
        panel: "var(--surface)", border: "var(--line)", item: "var(--muted)",
        itemHover: "var(--hover)", activeBg: "var(--accent-soft)", activeText: "var(--accent)",
    },
    status: { success: "var(--ok)", loading: "var(--running)", idle: "var(--waiting)", error: "var(--error)" },
    types: {
        text: "var(--t-script)", image: "var(--t-image)", panorama: "var(--t-image)",
        video: "var(--t-video)", audio: "var(--t-audio)", director: "var(--t-character)",
        config: "var(--t-script)", group: "var(--t-script)",
    },
    connection: "rgb(from var(--line-strong) calc(r + 5) calc(g + 5) calc(b + 6))",
} as const;

export const canvasThemes = { light: studioTheme, dark: studioTheme } as const;
export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
