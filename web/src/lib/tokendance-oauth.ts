import { tokenDanceAppUrl } from "@/lib/model-channel";

export type TokenDanceOAuthContext =
    | {
        target: "local";
        channelId: string;
    }
    | {
        target: "admin";
        draft: Record<string, unknown>;
        editingChannelIndex: number | null;
    };

export type TokenDanceOAuthState = TokenDanceOAuthContext & {
    verifier: string;
    returnTo: string;
};

export async function startTokenDanceOAuth(context: TokenDanceOAuthContext) {
    const flow = crypto.randomUUID();
    const verifier = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const callback = new URL("/tokendance/callback", window.location.origin);
    callback.searchParams.set("flow", flow);

    sessionStorage.setItem(`tokendance:oauth:${flow}`, JSON.stringify({
        ...context,
        verifier,
        returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    }));

    const authUrl = new URL("https://tokendance.space/auth");
    authUrl.searchParams.set("callback_url", callback.toString());
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("app_url", tokenDanceAppUrl);
    authUrl.searchParams.set("key_name", "Infinite Canvas");
    window.location.assign(authUrl);
}
