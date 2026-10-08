# 画布回归
前提：网站 localhost:3000、后端 8080、本机已安装 Google Chrome；依赖为 playwright-core，不下载浏览器。
运行：`cd app/web && node e2e/regression.mjs`；显示浏览器加 `--headed`。
可用 `E2E_BASE_URL` 指定网站（默认 http://localhost:3000）。
免登录时自动跳过登录；提供 `E2E_PASSWORD` 可登录，`E2E_USERNAME` 默认 qatester。
团队协作检查使用第二账号的独立 browser context；配置 `E2E_USERNAME2` / `E2E_PASSWORD2`，或在已忽略的 `e2e/.credentials.local.json` 中设置 `username2` / `password2`。第二账号密码缺省使用 `password`；未配置第二账号时团队协作项标记为跳过。环境变量优先，不提交凭据。
独立会话预置无密钥的本地测试模型，仅测菜单，不提交生成；自建画布在 finally 中删除。
每项截图与 report.json 放在已忽略的 `e2e/screens/`；失败退出码 1；剪贴板权限被拒只跳过复制粘贴。
新项：在 `checks` 中追加 `[项目名, async () => { ...断言... }]`，用现有 UI helper；每项自动清空节点、截图、汇总。需要跨页面延续状态时可用第三项 `false` 关闭默认清理。
㉔ 作品展示页：用测试画布拦截假展示接口，检查只读提示词、连入参考图、资产大图和助手聊天记录；不会调用发布接口。
㉚—㉝ 团队协作：可编辑邀请加入、团队画布双向同步和在线头像、viewer 只读状态、团队资产库共享；检查结束会解散测试团队并删除测试画布。
若 Chrome 启动受限，会输出失败并退出；请在能启动 Chrome 的终端运行。
