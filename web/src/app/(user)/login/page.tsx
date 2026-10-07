"use client";

import { App, Button, Form, Input, Segmented } from "antd";
import { GitBranch, LockKeyhole, Mail, User } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { completeGithubRegistration, completeGoogleRegistration, fetchAuthOptions, fetchCurrentUser, resetEmailPassword, sendEmailCode, type AuthOptions, type AuthSession } from "@/services/api/auth";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type Mode = "login" | "register" | "reset" | "google" | "github";
type FormValues = { username: string; email: string; code: string; password: string; confirmPassword: string; inviteCode: string };

function safeRedirect(value: string | null): string {
    const cleaned = (value ?? "").replace(/[\t\n\r]/g, "");
    return cleaned.startsWith("/") && !cleaned.startsWith("//") && !cleaned.startsWith("/\\") ? cleaned : "/";
}

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginContent />
        </Suspense>
    );
}

function LoginContent() {
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [form] = Form.useForm<FormValues>();
    const login = useUserStore((state) => state.login);
    const register = useUserStore((state) => state.register);
    const setSession = useUserStore((state) => state.setSession);
    const linuxDoEnabled = useConfigStore((state) => state.publicSettings?.auth?.linuxDo?.enabled === true);
    const allowRegister = useConfigStore((state) => state.publicSettings?.auth?.allowRegister !== false);
    const [mode, setMode] = useState<Mode>("login");
    const [details, setDetails] = useState(false);
    const [pendingToken, setPendingToken] = useState("");
    const [options, setOptions] = useState<AuthOptions>();
    const [optionsError, setOptionsError] = useState("");
    const [busy, setBusy] = useState(false);
    const [sending, setSending] = useState(false);
    const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
    const [clock, setClock] = useState(Date.now());
    const oauthHandled = useRef(false);
    const email = (Form.useWatch("email", form) ?? "").trim().toLowerCase();
    const remaining = Math.max(0, Math.ceil(((cooldowns[email] ?? 0) - clock) / 1000));
    const redirect = safeRedirect(searchParams.get("redirect"));
    const inviteRequired = options?.inviteRequired !== false;

    useEffect(() => {
        void fetchAuthOptions()
            .then(setOptions)
            .catch((error: unknown) => setOptionsError(error instanceof Error ? error.message : "登录配置获取失败"));
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => setClock(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (oauthHandled.current) return;
        oauthHandled.current = true;
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const token = fragment.get("authToken") || searchParams.get("token");
        const pending = fragment.get("googlePending");
        const githubPending = fragment.get("githubPending");
        const error = fragment.get("error") || searchParams.get("error");
        if (token || pending || githubPending || error) window.history.replaceState(null, "", `/login?redirect=${encodeURIComponent(redirect)}`);
        if (error) message.error(error);
        if (pending) {
            setPendingToken(pending);
            setMode("google");
        }
        if (githubPending) {
            setPendingToken(githubPending);
            setMode("github");
        }
        if (!token) return;
        setBusy(true);
        void fetchCurrentUser(token)
            .then((user) => {
                if (user.role === "guest") throw new Error("登录状态已过期，请重试");
                setSession(token, user);
                router.replace(redirect);
                router.refresh();
            })
            .catch((error: unknown) => message.error(error instanceof Error ? error.message : "登录失败"))
            .finally(() => setBusy(false));
    }, [message, redirect, router, searchParams, setSession]);

    const changeMode = (value: Mode) => {
        form.resetFields();
        setMode(value);
        setDetails(false);
        setPendingToken("");
    };

    const finishSession = (session: AuthSession) => {
        setSession(session.token, session.user);
        router.replace(redirect);
        router.refresh();
    };

    const sendCode = async () => {
        try {
            const values = await form.validateFields(["email"]);
            setSending(true);
            const result = await sendEmailCode(values.email, mode === "register" ? "register" : "reset");
            if (!result.mailConfigured) {
                setOptions((current) => (current ? { ...current, mailConfigured: false } : current));
                message.warning(result.message);
                return;
            }
            const deadline = Date.now() + result.retryAfter * 1000;
            setCooldowns((current) => ({ ...current, [values.email.trim().toLowerCase()]: deadline }));
            setClock(Date.now());
            setDetails(true);
            setOptions((current) => (current ? { ...current, mailConfigured: result.mailConfigured } : current));
            if (result.mailConfigured) message.success(result.message);
            else message.warning(result.message);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSending(false);
        }
    };

    const submit = async (values: FormValues) => {
        setBusy(true);
        try {
            if (mode === "login") {
                await login({ username: values.username, password: values.password });
                router.replace(redirect);
                router.refresh();
            } else if (mode === "register") {
                if (!allowRegister) throw new Error("当前未开放注册");
                await register({ username: values.username, password: values.password, email: values.email, code: values.code, inviteCode: values.inviteCode || "" });
                router.replace(redirect);
                router.refresh();
            } else if (mode === "reset") {
                finishSession(await resetEmailPassword({ email: values.email, code: values.code, password: values.password }));
            } else {
                finishSession(await (mode === "github" ? completeGithubRegistration(pendingToken, values.inviteCode || "") : completeGoogleRegistration(pendingToken, values.inviteCode || "")));
            }
            message.success(mode === "reset" ? "密码已重设，已自动登录" : mode === "register" ? "注册成功" : "登录成功");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setBusy(false);
        }
    };

    const emailFlow = mode === "register" || mode === "reset";
    const showCredentials = mode === "login" || (emailFlow && details);
    const iconProps = { size: 16, strokeWidth: 1.75, "aria-hidden": true as const };

    return (
        <main className="flex h-dvh overflow-y-auto bg-bg px-6 py-10 text-text">
            <section className="m-auto w-full max-w-[420px] shrink-0 rounded-card border border-line bg-surface p-8">
                <div className="mb-7 text-center">
                    <img src="/brand/mark.svg" width={48} height={48} alt="指尖造梦" className="mx-auto mb-4" />
                    <h1 className="text-page-title">{mode === "reset" ? "忘记密码" : mode === "google" ? "完成 Google 注册" : mode === "github" ? "完成 GitHub 注册" : "账号登录"}</h1>
                    <p className="mt-3 text-body text-muted-text">用账号密码、邮箱、Google 或 GitHub 登录</p>
                </div>
                {optionsError ? (
                    <p role="alert" className="mb-4 text-caption text-error">
                        {optionsError}，刷新页面可重试。
                    </p>
                ) : null}
                {emailFlow && options?.mailConfigured === false ? (
                    <p role="status" className="mb-4 text-caption text-warn">
                        邮件服务还没配置，请联系管理员
                    </p>
                ) : null}
                <Form<FormValues> form={form} layout="vertical" requiredMark={false} onFinish={submit}>
                    {mode === "login" || mode === "register" ? (
                        <Form.Item>
                            <Segmented
                                block
                                disabled={busy || sending}
                                value={mode}
                                onChange={(value) => changeMode(value as Mode)}
                                options={
                                    allowRegister
                                        ? [
                                              { label: "登录", value: "login" },
                                              { label: "邮箱注册", value: "register" },
                                          ]
                                        : [{ label: "登录", value: "login" }]
                                }
                            />
                        </Form.Item>
                    ) : null}
                    {emailFlow ? (
                        <>
                            <Form.Item
                                name="email"
                                label={mode === "reset" ? "注册邮箱" : "邮箱"}
                                rules={[
                                    { required: true, message: "请输入邮箱" },
                                    { type: "email", message: "请输入有效的邮箱" },
                                ]}
                            >
                                <Input prefix={<Mail {...iconProps} />} type="email" autoComplete="email" readOnly={details} />
                            </Form.Item>
                            {details ? (
                                <>
                                    <Form.Item
                                        name="code"
                                        label="6 位验证码"
                                        rules={[
                                            { required: true, message: "请输入验证码" },
                                            { pattern: /^\d{6}$/, message: "验证码为 6 位数字" },
                                        ]}
                                    >
                                        <Input autoComplete="one-time-code" inputMode="numeric" maxLength={6} />
                                    </Form.Item>
                                    <div className="mb-4 flex items-center justify-between">
                                        <Button type="text" disabled={remaining > 0 || busy} loading={sending} onClick={() => void sendCode()}>
                                            {remaining > 0 ? `${remaining} 秒后重发` : "重新发送"}
                                        </Button>
                                        <Button
                                            type="text"
                                            disabled={busy || sending}
                                            onClick={() => {
                                                setDetails(false);
                                                form.setFieldsValue({ code: "" });
                                            }}
                                        >
                                            更换邮箱
                                        </Button>
                                    </div>
                                    <p className="mb-4 text-caption text-muted-text">验证码 10 分钟内有效，连续错 5 次作废。</p>
                                </>
                            ) : (
                                <Button block loading={sending} disabled={remaining > 0 || busy || options?.mailConfigured === false} onClick={() => void sendCode()}>
                                    {remaining > 0 ? `${remaining} 秒后可发送` : "发送验证码，下一步"}
                                </Button>
                            )}
                        </>
                    ) : null}
                    {mode === "login" || (mode === "register" && details) ? (
                        <Form.Item name="username" label={mode === "login" ? "用户名或邮箱" : "用户名"} rules={[{ required: true, message: "请输入用户名或邮箱" }]}>
                            <Input prefix={<User {...iconProps} />} autoComplete="username" maxLength={254} />
                        </Form.Item>
                    ) : null}
                    {showCredentials ? (
                        <>
                            <Form.Item name="password" label={mode === "reset" ? "新密码" : "密码"} rules={[{ required: true, message: "请输入密码" }, ...(mode !== "login" ? [{ min: 8, max: 72, message: "密码至少 8 字符，最多 72 字节" }] : [])]}>
                                <Input.Password prefix={<LockKeyhole {...iconProps} />} autoComplete={mode === "login" ? "current-password" : "new-password"} />
                            </Form.Item>
                            {mode !== "login" ? (
                                <Form.Item
                                    name="confirmPassword"
                                    label="确认密码"
                                    dependencies={["password"]}
                                    rules={[{ required: true, message: "请再次输入密码" }, { validator: (_, value) => (value === form.getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致"))) }]}
                                >
                                    <Input.Password autoComplete="new-password" />
                                </Form.Item>
                            ) : null}
                        </>
                    ) : null}
                    {mode === "google" || mode === "github" || (mode === "register" && details) ? (
                        <>
                            {mode === "google" ? <p className="mb-4 text-body text-muted-text">首次使用 Google 登录，请补填邀请码。完成后会自动登录。</p> : null}
                            {mode === "github" ? <p className="mb-4 text-body text-muted-text">首次使用 GitHub 登录，请补填邀请码。完成后会自动登录。</p> : null}
                            <Form.Item name="inviteCode" label={inviteRequired ? "邀请码" : "邀请码（选填）"} rules={[{ required: inviteRequired, message: "请输入管理员提供的邀请码" }]}>
                                <Input autoComplete="off" maxLength={64} />
                            </Form.Item>
                        </>
                    ) : null}
                    {showCredentials || mode === "google" || mode === "github" ? (
                        <Button block type="primary" htmlType="submit" loading={busy} disabled={sending}>
                            {mode === "reset" ? "重设密码并登录" : mode === "register" || mode === "google" || mode === "github" ? "完成注册" : "登录"}
                        </Button>
                    ) : null}
                </Form>
                {mode === "login" ? (
                    <Button block type="text" disabled={busy} className="mt-3" onClick={() => changeMode("reset")}>
                        忘记密码
                    </Button>
                ) : null}
                {mode === "reset" || mode === "google" || mode === "github" ? (
                    <Button block type="text" disabled={busy || sending} className="mt-3" onClick={() => changeMode("login")}>
                        返回登录
                    </Button>
                ) : (
                    <div className="mt-4">
                        <div className="flex gap-2">
                            <Button block disabled={!options?.googleEnabled || busy || sending} href={options?.googleEnabled ? `/api/auth/google/authorize?redirect=${encodeURIComponent(redirect)}` : undefined}>
                                使用 Google 继续
                            </Button>
                            {options?.githubEnabled ? (
                                <Button block disabled={busy || sending} href={`/api/auth/github/authorize?redirect=${encodeURIComponent(redirect)}`} icon={<GitBranch {...iconProps} />}>
                                    GitHub 登录
                                </Button>
                            ) : null}
                        </div>
                        {options && !options.googleEnabled ? <p className="mt-2 text-center text-caption text-muted-text">Google 登录还没配置，请联系管理员</p> : null}
                    </div>
                )}
                <div hidden>{linuxDoEnabled ? <Button href={`/api/auth/linux-do/authorize?redirect=${encodeURIComponent(redirect)}`}>使用 Linux.do 登录</Button> : null}</div>
                <p className="mt-6 border-t border-line pt-4 text-center text-caption text-muted-text">
                    <a href="/privacy" className="transition-colors hover:text-text">隐私政策</a>
                    <span className="px-2" aria-hidden="true">·</span>
                    <a href="/terms" className="transition-colors hover:text-text">服务条款</a>
                </p>
            </section>
        </main>
    );
}
