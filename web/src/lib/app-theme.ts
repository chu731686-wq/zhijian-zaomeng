import type { CSSProperties } from "react";
import { theme as antdTheme, type ThemeConfig } from "antd";

// Keep these values in sync with SPEC-v2 and globals.css. Components use CSS variables.
export const studioTokens = {
    bg: "#0E0E10",
    surface: "#16161A",
    raised: "#1E1E23",
    hover: "#26262C",
    line: "#2C2C33",
    lineStrong: "#45454F",
    text: "#F3F2F0",
    muted: "#B0AFB5",
    subtle: "#85848C",
    accent: "#F2806E",
    accentHover: "#F59383",
    accentInk: "#2A0F0B",
    accentSoft: "rgba(242,128,110,.14)",
    ok: "#6FCF97",
    running: "#6AA8FF",
    waiting: "#85848C",
    error: "#FF6B6B",
    warn: "#F2C14E",
    script: "#D6D3CC",
    character: "#E8A6C0",
    image: "#5CC8C0",
    video: "#B39CF2",
    audio: "#E3B26E",
};

export const adminLayoutStyle = {
    siderWidth: 232,
    headerHeight: 56,
    brandHeight: 56,
    menu: { borderInlineEnd: 0, padding: "18px 12px", fontSize: 15 } satisfies CSSProperties,
    menuItem: { height: 44, lineHeight: "44px", marginBlock: 4, borderRadius: 8 } satisfies CSSProperties,
};

export function getAntThemeConfig(dark = true): ThemeConfig {
    const c = studioTokens;
    return {
        algorithm: antdTheme.darkAlgorithm,
        cssVar: { key: dark ? "studio-dark" : "studio-default" },
        token: {
            colorPrimary: c.accent,
            colorPrimaryHover: c.accentHover,
            colorPrimaryActive: c.accent,
            colorInfo: c.running,
            colorSuccess: c.ok,
            colorWarning: c.warn,
            colorError: c.error,
            colorBgBase: c.bg,
            colorBgLayout: c.bg,
            colorBgContainer: c.surface,
            colorBgElevated: c.raised,
            colorFillSecondary: c.raised,
            colorFillTertiary: c.hover,
            colorBorder: c.line,
            colorBorderSecondary: c.line,
            colorText: c.text,
            colorTextSecondary: c.muted,
            colorTextTertiary: c.muted,
            colorTextQuaternary: c.subtle,
            colorTextDisabled: c.subtle,
            colorTextLightSolid: c.accentInk,
            colorLink: c.text,
            colorLinkHover: c.accentHover,
            colorLinkActive: c.accent,
            fontFamily: '"PingFang SC","Noto Sans SC",system-ui,sans-serif',
            fontSize: 14,
            borderRadius: 8,
            borderRadiusLG: 14,
            controlHeight: 40,
            controlHeightSM: 36,
            lineWidthFocus: 2,
            colorPrimaryBorder: c.accent,
        },
        components: {
            Button: { primaryShadow: "none", primaryColor: c.accentInk, defaultBg: c.raised, defaultBorderColor: c.line, defaultColor: c.text },
            Input: { colorBgContainer: c.raised, activeBorderColor: c.accent, hoverBorderColor: c.lineStrong },
            Menu: { itemActiveBg: c.raised, itemHoverBg: c.hover, itemSelectedBg: c.raised, itemSelectedColor: c.text, darkItemBg: c.surface, darkItemHoverBg: c.hover, darkItemSelectedBg: c.raised, darkItemSelectedColor: c.text },
            Select: { optionActiveBg: c.hover, optionSelectedBg: c.raised, optionSelectedColor: c.text },
            Table: { rowSelectedBg: c.raised, rowSelectedHoverBg: c.hover },
        },
    };
}
