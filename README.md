# 樱语 · Sakura Chat

樱花主题的 AI 对话网站：Next.js 16 (App Router) + Tailwind CSS v4 + shadcn/ui，
Auth.js v5 (Credentials + JWT)，Prisma 7 + Cloudflare D1，DeepSeek 流式对话（AI SDK v7），
通过 @opennextjs/cloudflare 部署到 Cloudflare Workers。

## 本地开发

数据库是 Cloudflare D1（本地由 Wrangler/miniflare 提供），首次运行：

```bash
npx wrangler d1 migrations apply sakura-ai-chat-db --local
npm run dev
```

`next.config.ts` 调用了 `initOpenNextCloudflareForDev()`，所以 `next dev` 里的
`getCloudflareContext().env.DB` 指向本地 D1，与 Workers 使用同一套 Prisma D1 适配器。

本地环境变量：

- `.env.local`（Next 进程）：`AUTH_SECRET`、`DEEPSEEK_CONTEXT_TOKENS`、`DEEPSEEK_MODEL`（默认 `deepseek-flash`）、
  以及加密后的 `DEEPSEEK_API_KEY_ENC`（见「API 密钥加密」）。`DATABASE_URL` 仅供可选的 Prisma CLI 使用，运行时不再读取。
- `.dev.vars`（Wrangler 绑定，`npm run preview` / `wrangler dev` 用）：`AUTH_SECRET`、`DEEPSEEK_API_KEY`。

打开 http://localhost:3000 ，注册账号后即可对话。

## 部署到 Cloudflare Workers

使用 @opennextjs/cloudflare + Workers（不是 Pages）。

```bash
# 已创建并写入 wrangler.jsonc；换账号时重建并把 database_id 填回去
npx wrangler d1 create sakura-ai-chat-db
npx wrangler d1 migrations apply sakura-ai-chat-db --remote

npx wrangler secret put AUTH_SECRET
npx wrangler secret put DEEPSEEK_API_KEY

npm run preview   # 本地 Workers 运行时预览
npm run deploy    # 构建并部署
node tools/verify-cloudflare.mjs https://<worker>.workers.dev
```

关键约束：

- **Middleware 文件名必须是 `middleware.ts`**。@opennextjs/cloudflare 不识别 Next 16 的 `proxy.ts`，
  改名会让路由保护静默失效；且 Middleware 只能做轻量 cookie 检查，不能引入 Prisma/Argon2。
- **不要开启 `cacheComponents`**：与 OpenNext Cloudflare 不兼容，页面会只返回静态外壳。
- Prisma 只通过 D1 binding（`env.DB`）访问，没有 `DATABASE_URL` 连接字符串；
  Client 在请求内惰性实例化，不在模块顶层创建。
- 密码哈希使用 `@noble/hashes` 的纯 JS Argon2id（`@node-rs/argon2` 的原生模块在 Workers 无法加载），
  参数仍是 m=19456、t=2、p=1，旧哈希可直接验证。
- **哈希在 Durable Object 中执行**：Workers 免费计划每次请求只有 10ms CPU，而 Argon2 约需 250ms；
  Durable Object `AuthHasher` 在免费计划也可用且每次调用有 30s CPU。主 Worker 只做一次 RPC，
  因此免费计划也能稳定注册和登录。`wrangler.jsonc` 中对应 `durable_objects` 与
  `new_sqlite_classes` 迁移；`worker/entry.ts` 在 OpenNext 生成的 Worker 上挂载这个类。
- 本地文件存档依赖文件系统，在 Workers 上不可用：侧栏会隐藏「存档管理」，相关 API 返回 501 并说明原因；
  D1 对话持久化不受影响。

## API 密钥加密

DeepSeek 密钥以 AES-256-GCM 密文保存在 `.env.local` 的 `DEEPSEEK_API_KEY_ENC`。32 字节主密钥放在
项目之外：`~/.sakura-chat/master.key`（首次使用时自动创建，权限 600），或环境变量 `SAKURA_MASTER_KEY`。
因此项目目录、备份和 git 历史里都没有明文密钥；服务端只在发起请求时解密到内存。

- `npm run secret:status` 查看状态（不会输出密钥本身）
- `npm run secret:migrate` 把 `.env.local` 里的明文密钥加密并移除（一次性迁移）
- 轮换密钥：`Get-Content key.txt | npm run secret:set`（或粘贴后 Ctrl+Z / Ctrl+D），写完重启服务
- 更换主密钥后旧密文无法解密，需要重新 `secret:set`
- 这是「静态加密」：服务器必须解密才能调用 API，因此它保护磁盘上的文件，不能防止整台机器被攻陷

## 人设与多对话

- 每次新建对话都会弹出人设窗口，可选 7 种预设（温柔学姐、严谨工程师、幽默损友、古典诗人、耐心老师、效率管家、zhj），
  或点「使用默认人设」不添加任何额外设定。
- 人设保存在 `Conversation.personaId`，每次请求由服务端拼接到 `system` 提示词，与基础系统提示词同级。
  它不在消息列表里，所以「清除上下文」和 20 条上下文裁剪都不会移除或压缩它。
- 左侧栏管理对话：新建、切换、删除；「清除上下文」只删消息，保留对话与人设。对话标题自动取首条用户消息。
- 输入框下方有上下文用量条：按字符实时估算（系统提示 + 人设 + 最近 20 条消息 + 当前草稿），并显示上一次请求由
  DeepSeek 返回的真实 `usage`。真实用量会随助手消息一起存入数据库，刷新后仍然可见。

## 本地存档

侧栏「存档管理」面板把对话同时写到本地文件，默认目录 `./archives`（可用面板更改并迁移）：

```
archives/<conversationId>/
  transcript.md   可读对话记录
  context.jsonl   逐条结构化记录（index、role、messageId、时间、正文）
  meta.json       会话信息与存档状态
```

- 每个会话有「存档」「自动读取」两个开关；关掉存档只停止写入，已有文件保留。
- 开启存档时会从已提交的消息日志回填（只追加缺失记录，不覆盖旧存档）。
- 自动读取的触发点：每 20 轮、上下文被压缩、上下文被清除，或面板里点「立即读取」。
  读回的存档节选会拼进当次系统提示词（人设之下），不进入消息列表，因此不会被再次压缩。
- 「新对话默认开启存档」是总开关，决定之后新建会话是否默认开启存档与自动读取。
- 面板还提供「立即导出」「打开目录」「删除文件」；删除文件不影响对话本身。

## 目录

- `app/login` 登录/注册页，`app/chat` 受保护对话页
- `app/chat/[id]` 单个对话页；`app/chat/layout.tsx` 带对话侧栏的受保护布局
- `middleware.ts` 轻量路由守卫（仅检查会话 cookie，不做数据库访问；OpenNext Cloudflare 只认这个文件名）
- `app/api/chat/route.ts` DeepSeek SSE 流式接口（`convertToModelMessages` + `streamText` + 服务端解析人设）
- `app/api/conversations` 对话增删查，`app/api/conversations/[id]/messages` 消息写入与清空
- `app/api/auth/register` 注册
- `auth.config.ts` Edge 安全的 Auth.js 选项；`lib/auth.ts` 注入 Credentials provider
- `lib/db.ts` Prisma D1 适配器与请求内惰性客户端
- `lib/password-core.ts` 纯 JS Argon2id（@noble/hashes）；`lib/password.ts` 在 Workers 上走 Durable Object，本地走纯 JS
- `worker/entry.ts` / `worker/auth-hasher.ts` Worker 入口包装与 Argon2 Durable Object
- `lib/personas.ts` 人设预设与系统提示词拼装
- `lib/usage.ts` 上下文窗口常量、token 估算与格式化
- `lib/archive.ts` 本地存档读写（Workers 上禁用）
- `wrangler.jsonc` / `open-next.config.ts` / `d1-migrations/` Cloudflare 部署配置与 D1 迁移
- `cloudflare-env.d.ts` 由 `npm run cf-typegen` 生成的绑定类型
- `app/api/archive` 存档管理接口（开关、导出、读取、删文件、改目录、打开目录）
- `components/ArchivePanel.tsx` 存档管理面板
- `components/SakuraBackground.tsx` Canvas 2D 樱花背景（经 `SakuraMount` 以 `ssr:false` 加载）
- `components/ChatShell.tsx` 对话侧栏与顶栏，`components/PersonaDialog.tsx` 人设弹窗
- `components/ChatPanel.tsx` 对话 UI

## 离线联调

无真实密钥时可用本地 mock 验证流式链路：

```bash
node tools/mock-deepseek.mjs
DEEPSEEK_BASE_URL="http://127.0.0.1:8788/v1" npm run dev
```

`node tools/smoke-live.mjs [baseUrl]` 用真实 API 跑一次流式对话。
`node tools/verify-cloudflare.mjs [baseUrl]` 覆盖 Workers 运行时验收：注册/登录、D1 持久化、SSE 增量、
用量回显、跨用户隔离、存档 501 与 Middleware 重定向。
`tools/verify-persona.mjs` 覆盖人设注入与对话隔离（需 mock + 3000 端口服务）。
