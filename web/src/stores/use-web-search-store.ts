"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useUserStore } from "./use-user-store";

type WebSearchStore = {
    enabledByUser: Record<string, boolean>;
    providerByUser: Record<string, "off" | "toutiao" | "bing" | "bocha">;
    setEnabled: (userId: string, enabled: boolean) => void;
    setProvider: (userId: string, provider: "off" | "toutiao" | "bing" | "bocha") => void;
};

// Only the small switch preference is persisted; provider secrets stay on the server.
export const useWebSearchStore = create<WebSearchStore>()(persist((set) => ({
    enabledByUser: {},
    providerByUser: {},
    setEnabled: (userId, enabled) => set((state) => ({
        enabledByUser: { ...state.enabledByUser, [userId]: enabled },
        providerByUser: { ...state.providerByUser, [userId]: enabled ? (state.providerByUser[userId] === "off" ? "toutiao" : state.providerByUser[userId] || "toutiao") : "off" },
    })),
    setProvider: (userId, provider) => set((state) => ({
        enabledByUser: { ...state.enabledByUser, [userId]: provider !== "off" },
        providerByUser: { ...state.providerByUser, [userId]: provider },
    })),
}), { name: "canvas-web-search-preferences" }));

export type WebSearchProvider = "off" | "toutiao" | "bing" | "bocha";

function providerForUser(userId: string): WebSearchProvider {
    const state = useWebSearchStore.getState();
    return state.providerByUser[userId] || (state.enabledByUser[userId] === false ? "off" : "toutiao");
}

export function isWebSearchEnabled() {
    const userId = useUserStore.getState().user?.id || "anonymous";
    return providerForUser(userId) !== "off";
}

export function useWebSearchPreference() {
    const userId = useUserStore((state) => state.user?.id || "anonymous");
    const provider = useWebSearchStore((state) => state.providerByUser[userId] || (state.enabledByUser[userId] === false ? "off" : "toutiao"));
    const setEnabled = useWebSearchStore((state) => state.setEnabled);
    const setProvider = useWebSearchStore((state) => state.setProvider);
    return { provider, enabled: provider !== "off", setEnabled: (value: boolean) => setEnabled(userId, value), setProvider: (value: WebSearchProvider) => setProvider(userId, value) };
}
