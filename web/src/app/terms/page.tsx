import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "服务条款 | 指尖造梦 Zhijian Zaomeng",
    description: "指尖造梦 Zhijian Zaomeng 服务条款",
};

const clauses = [
    {
        title: "服务性质",
        zh: "指尖造梦 Zhijian Zaomeng 是个人作品集性质的免费服务。服务按“现状”提供，我们不保证服务始终可用、不中断或没有错误。",
        en: "Zhijian Zaomeng is a free service provided as a personal portfolio project. The service is provided “as is”; we do not guarantee that it will always be available, uninterrupted, or error-free.",
    },
    {
        title: "你的内容与费用",
        zh: "你对自己上传的内容负责，并应确保拥有上传和使用这些内容所需的权利。使用你自己的 API 密钥调用模型所产生的费用由你负责。",
        en: "You are responsible for the content you upload and must have the rights needed to upload and use it. You are responsible for any charges incurred when model services are called using your own API keys.",
    },
    {
        title: "禁止的使用方式",
        zh: "你不得上传、创作或传播违法内容，也不得利用本服务从事违法活动。",
        en: "You may not upload, create, or distribute unlawful content, or use the service for unlawful activities.",
    },
    {
        title: "账号终止",
        zh: "如账号违反本条款或被用于违规行为，我们可随时终止该账号的使用权限。",
        en: "We may terminate an account at any time if it violates these terms or is used for prohibited conduct.",
    },
    {
        title: "条款更新",
        zh: "我们可随时更新本条款。更新后的条款发布后生效；继续使用服务即表示你接受更新后的条款。",
        en: "We may update these terms at any time. Updated terms take effect when posted; continued use of the service means you accept the updated terms.",
    },
];

export default function TermsPage() {
    return (
        <main className="min-h-dvh overflow-y-auto bg-bg px-6 py-12 text-text sm:px-8">
            <article className="mx-auto w-full max-w-3xl rounded-card border border-line bg-surface p-6 sm:p-10">
                <header className="border-b border-line pb-6">
                    <a href="/login" className="text-caption text-muted-text transition-colors hover:text-text">指尖造梦 Zhijian Zaomeng</a>
                    <h1 className="mt-4 text-page-title">服务条款 <span className="text-section-title text-muted-text">Terms of Service</span></h1>
                    <p className="mt-3 text-caption text-muted-text">生效日期：2026-10-08 · Effective date: 2026-10-08</p>
                </header>
                <div className="space-y-8 py-7 text-body leading-7 text-muted-text">
                    <section className="space-y-3">
                        <h2 className="text-section-title text-text">使用本服务</h2>
                        <p>访问或使用指尖造梦 Zhijian Zaomeng，即表示你同意本服务条款。</p>
                        <p lang="en">By accessing or using Zhijian Zaomeng, you agree to these Terms of Service.</p>
                    </section>
                    {clauses.map((clause) => (
                        <section key={clause.title} className="space-y-3">
                            <h2 className="text-section-title text-text">{clause.title}</h2>
                            <p>{clause.zh}</p>
                            <p lang="en" className="border-l border-line pl-4">{clause.en}</p>
                        </section>
                    ))}
                    <section className="space-y-3">
                        <h2 className="text-section-title text-text">联系我们</h2>
                        <p>关于本条款的问题，请联系 <a className="text-accent hover:underline" href="mailto:chu731686@gmail.com">chu731686@gmail.com</a>。</p>
                        <p lang="en">For questions about these terms, contact <a className="text-accent hover:underline" href="mailto:chu731686@gmail.com">chu731686@gmail.com</a>.</p>
                    </section>
                </div>
                <footer className="border-t border-line pt-5 text-caption text-muted-text">
                    <a href="/privacy" className="transition-colors hover:text-text">隐私政策 · Privacy Policy</a>
                </footer>
            </article>
        </main>
    );
}
