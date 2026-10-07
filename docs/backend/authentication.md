# 登录、注册与邀请码

启动方式沿用项目现有后端与前端开发命令。前端默认地址 `http://localhost:3000`，后端默认 `http://127.0.0.1:8080`。后台入口可直接访问 `/admin`，登录页直接访问 `/login`。

## 本机没有 SMTP 时的完整流程

1. `.env` 留空 `SMTP_HOST`、`SMTP_FROM`，`REGISTRATION_INVITE_REQUIRED=true`（默认）。保持后端终端可见。请使用固定 `JWT_SECRET`，否则重启会使已有会话与验证码失效。
2. 用 `.env` 中的管理员账号密码登录，打开 `/admin/invites`，生成并复制一个邀请码。退出或在另一浏览器窗口打开 `/login`。
3. 选择“邮箱注册”，输入邮箱，点击“发送验证码，下一步”。页面显示“邮件服务还没配置，请联系管理员”；后端终端输出 `[email-code] purpose=register email=... code=123456 expires_in=600s`。容器部署在后端容器日志里查看。
4. 填入日志中的 6 位验证码、用户名、至少 8 字节的新密码与邀请码，完成注册并自动登录。用户名或邮箱均可用于密码登录。
5. 退出登录，点击“忘记密码”，填入刚才的注册邮箱。距上一次发码不足 60 秒时等满 60 秒；冷却按邮箱跨注册/重设用途共用。
6. 发出重设验证码，在后端日志查找 `purpose=reset` 的最新记录。输入验证码与新密码并确认，点击“重设密码并登录”。成功后自动登录；旧密码失效，新密码可登录。

生产配置 SMTP 后，验证码发送到收件箱，后端不再打印明文验证码。缺失/未知或有歧义的重设邮箱不会发邮件/打印验证码，接口使用相同的通用提示。

## 配置

- `REGISTRATION_INVITE_REQUIRED`：默认 `true`，`false` 时邀请码选填。如果填了邀请码，仍必须有效且只能消费一次。管理员账号的首次启动创建不受注册邀请开关影响。
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`：端口默认 587（STARTTLS），465 使用隐式 TLS；外部邮件服务要求加密，仅 localhost/回环 IP 的调试中继可使用明文。无需认证的中继可留空 USER/PASS。
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URL`：全部有效时启用按钮。本机回调例 `http://localhost:3000/api/auth/google/callback`，生产使用 `https://你的前端域名/api/auth/google/callback`；必须与 Google 控制台授权回调完全一致，前端 API 代理会转发 Cookie 与重定向。

Google 采用标准 HTTP 授权码换取 access token，再读取已验证邮箱与稳定的用户 `sub`。使用签名 state、HttpOnly/SameSite Cookie 绑定浏览器，state 和首次注册凭证均 10 分钟有效；首次邀请码未通过前不会建立账号/登录会话。首次注册凭证和会话通过 URL fragment 返回，页面读完即移除。Google 邮箱已对应另一个邮箱账号时拒绝自动合并，可用原邮箱/密码或忘记密码登录。

原 Linux.do 服务和路由保留，页面入口隐藏；邀请要求开启时已有 Linux.do 账号仍可登录，新账号须使用邮箱或 Google 注册。

## 接口

所有 JSON 接口沿用 `{code,data,msg}`。

| 方法/路径 | 请求或用途 |
| --- | --- |
| GET `/api/auth/options` | 公开 SMTP 是否已配置、Google 是否启用、邀请码是否必填，不包含密钥 |
| POST `/api/auth/login` | `{username,password}`，username 接受用户名或邮箱 |
| POST `/api/auth/email-code` | `{email,purpose}`，purpose 为 register/reset；返回 mailConfigured、message、retryAfter |
| POST `/api/auth/register` | `{email,code,username,password,inviteCode}`；返回会话 |
| POST `/api/auth/reset-password` | `{email,code,password}`；返回会话 |
| GET `/api/auth/google/authorize?redirect=/站内路径` | 重定向到 Google |
| GET `/api/auth/google/callback` | Google 回调 |
| POST `/api/auth/google/register` | `{pendingToken,inviteCode}`；返回会话 |
| GET/POST `/api/admin/invites` | 管理员列出/生成单个邀请码 |
| DELETE `/api/admin/invites/:code` | 管理员作废尚未使用的邀请码 |

密码沿用 bcrypt，新增/重设密码为 8–72 字节。验证码、邀请码的成功消费与账号变更同事务提交；错误码次数独立持久化。发送上限：每邮箱 5 次/小时、每 IP 20 次/小时；验证码提交：每邮箱 15 次/10 分钟、每 IP 30 次/10 分钟；密码登录：每账号 20 次/10 分钟、每 IP 30 次/10 分钟。Google 发起/邀请码完成各限制每 IP 30 次/10 分钟。发送请求即计数，频繁点击也会消耗限额。

IP 使用 TCP 连接来源，不信任转发头。经前端代理的用户共享代理 IP 的限额，适用于本任务的小团队规模；超过限额后等待对应窗口到期。

## 用户模型密钥加密

用户模型配置中 `localChannels[].apiKey` 使用 AES-256-GCM 加密后写入数据库，数据库值以 `enc:v1:` 开头；读取配置和调用模型时由服务端解密，对前端保持原有明文配置格式。启动时会自动把旧记录中的明文密钥加密。

生产环境应在 `.env` 设置并备份 `CONFIG_ENCRYPTION_KEY`。未设置时会从 `JWT_SECRET` 派生，并在启动日志中警告。若显式配置的加密密钥丢失或更换，已存的密钥无法解开，用户需要重新填写模型 API 密钥；请勿删除或更换备份的密钥。
