import { apiGet, apiPost } from "@/services/api/request";

export const AUTH_TOKEN_KEY = "infinite-canvas-auth-token-v1";

export type UserRole = "guest" | "user" | "admin";

export type AuthUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    role: UserRole;
    credits: number;
    createdAt: string;
    updatedAt: string;
    usingDefaultPassword?: boolean;
};

export type AuthSession = {
    token: string;
    user: AuthUser;
};

export type AuthPayload = {
    username: string;
    password: string;
};

export type EmailRegisterPayload = AuthPayload & { email: string; code: string; inviteCode: string };
export type AuthOptions = { mailConfigured: boolean; googleEnabled: boolean; githubEnabled: boolean; inviteRequired: boolean };

export function fetchAuthOptions() {
    return apiGet<AuthOptions>("/api/auth/options");
}

export function sendEmailCode(email: string, purpose: "register" | "reset") {
    return apiPost<{ mailConfigured: boolean; message: string; retryAfter: number }>("/api/auth/email-code", { email, purpose });
}

export function resetEmailPassword(payload: { email: string; code: string; password: string }) {
    return apiPost<AuthSession>("/api/auth/reset-password", payload);
}

export function completeGoogleRegistration(pendingToken: string, inviteCode: string) {
    return apiPost<AuthSession>("/api/auth/google/register", { pendingToken, inviteCode });
}

export function completeGithubRegistration(pendingToken: string, inviteCode: string) {
    return apiPost<AuthSession>("/api/auth/github/register", { pendingToken, inviteCode });
}

export async function login(payload: AuthPayload) {
    return apiPost<AuthSession>("/api/auth/login", payload);
}

export async function register(payload: EmailRegisterPayload) {
    return apiPost<AuthSession>("/api/auth/register", payload);
}

export async function fetchCurrentUser(token?: string) {
    return apiGet<AuthUser>("/api/auth/me", undefined, token);
}
