// OAuth sign-in returns to /login; TokenDance has its own public callback page.
export function isPublicAuthPage(pathname: string) {
    return pathname === "/login" || pathname === "/tokendance/callback" || pathname === "/privacy" || pathname === "/terms";
}
