import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "隐私政策 | 指尖造梦 Zhijian Zaomeng",
    description: "指尖造梦 Zhijian Zaomeng 隐私政策",
};

const sections = [
    {
        title: "我们收集的信息",
        body: (
            <>
                <p>我们收集账号信息，包括用户名和邮箱地址。使用 Google 或 GitHub 登录时，我们仅获取用于登录的名字、邮箱和头像。</p>
                <p>你创作的画布以及上传的图片、视频会存储在我们的服务器上。你自行填写的模型 API 密钥会加密保存，仅用于代你调用你选择的模型服务。</p>
                <p>为维持登录状态和网站基本功能，我们会使用必要的登录 Cookie 和本地存储。</p>
            </>
        ),
        english: (
            <>
                <p>We collect account information, including your username and email address. When you sign in with Google or GitHub, we only obtain your name, email, and profile picture for sign-in.</p>
                <p>Your canvases and uploaded images and videos are stored on our servers. Model API keys you provide are encrypted at rest and used only to call the model services you select on your behalf.</p>
                <p>We use necessary sign-in cookies and local storage to maintain your session and provide basic website functions.</p>
            </>
        ),
    },
    {
        title: "信息的使用与披露",
        body: (
            <>
                <p>我们使用上述信息提供账号登录、保存你的创作并调用你选择的模型服务。我们不出售你的个人信息，也不会将其用于广告。</p>
                <p>如需删除账号及相关数据，请发送邮件至 <a className="text-accent hover:underline" href="mailto:chu731686@gmail.com">chu731686@gmail.com</a>。</p>
            </>
        ),
        english: (
            <>
                <p>We use this information to provide account access, save your work, and call the model services you select. We do not sell your personal information or use it for advertising.</p>
                <p>To request deletion of your account and associated data, email <a className="text-accent hover:underline" href="mailto:chu731686@gmail.com">chu731686@gmail.com</a>.</p>
            </>
        ),
    },
    {
        title: "Policy Updates",
        body: <p>我们可能会不时更新本隐私政策。上方的生效日期标明本版本的生效时间。</p>,
        english: <p>We may update this Privacy Policy from time to time. The effective date above indicates when this version took effect.</p>,
    },
];

export default function PrivacyPage() {
    return (
        <main className="min-h-dvh overflow-y-auto bg-bg px-6 py-12 text-text sm:px-8">
            <article className="mx-auto w-full max-w-3xl rounded-card border border-line bg-surface p-6 sm:p-10">
                <header className="border-b border-line pb-6">
                    <a href="/login" className="text-caption text-muted-text transition-colors hover:text-text">指尖造梦 Zhijian Zaomeng</a>
                    <h1 className="mt-4 text-page-title">隐私政策 <span className="text-section-title text-muted-text">Privacy Policy</span></h1>
                    <p className="mt-3 text-caption text-muted-text">生效日期：2026-10-08 · Effective date: 2026-10-08</p>
                </header>
                <div className="space-y-8 py-7 text-body leading-7 text-muted-text">
                    <section className="space-y-3">
                        <h2 className="text-section-title text-text">概述</h2>
                        <p>本政策说明指尖造梦 Zhijian Zaomeng 如何处理你在使用本服务时提供的信息。</p>
                        <p lang="en">This policy explains how Zhijian Zaomeng handles information you provide when using the service.</p>
                    </section>
                    {sections.map((section) => (
                        <section key={section.title} className="space-y-3">
                            <h2 className="text-section-title text-text">{section.title === "Policy Updates" ? "政策更新 · Policy Updates" : section.title}</h2>
                            <div className="space-y-3">{section.body}</div>
                            <div lang="en" className="space-y-3 border-l border-line pl-4">{section.english}</div>
                        </section>
                    ))}
                    <section className="space-y-3">
                        <h2 className="text-section-title text-text">联系我们</h2>
                        <p>如对本政策或个人信息有疑问，请联系 <a className="text-accent hover:underline" href="mailto:chu731686@gmail.com">chu731686@gmail.com</a>。</p>
                        <p lang="en">For questions about this policy or your personal information, contact <a className="text-accent hover:underline" href="mailto:chu731686@gmail.com">chu731686@gmail.com</a>.</p>
                    </section>
                </div>
                <footer className="border-t border-line pt-5 text-caption text-muted-text">
                    <a href="/terms" className="transition-colors hover:text-text">服务条款 · Terms of Service</a>
                </footer>
            </article>
        </main>
    );
}
