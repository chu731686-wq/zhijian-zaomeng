import { create } from "zustand";
import type { TeamSharedChannel } from "@/services/api/team";

// Canvas-only, in-memory metadata. Never persisted into personal model settings.
export const useTeamModelStore = create<{
    canvasId: string;
    teamId: string;
    teamName: string;
    channels: TeamSharedChannel[];
}>(() => ({ canvasId: "", teamId: "", teamName: "", channels: [] }));
