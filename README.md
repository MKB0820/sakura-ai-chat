# 樱语 · Sakura Chat

樱花主题的 AI 对话网站：Next.js 16 (App Router) + Tailwind CSS v4 + shadcn/ui，
Auth.js v5 (Credentials + JWT)，Prisma 7 + SQLite，DeepSeek 流式对话（AI SDK v7）。

## 快速开始

1. 编辑 `.env.local`，把 `DEEPSEEK_API_KEY` 换成真实密钥（当前为占位符）：

```
DEEPSEEK_API_KEY="sk-..."
```

可选配置（用量条与模型选择依赖它们）：

```
# 默认 deepseek-chat；当前 DeepSeek API 将该别名映射到 DeepSeek-V4.1-Flash
DEEPSEEK_MODEL="deepseek-chat"
# 用量条使用的上下文窗口，需与模型实际窗口一致
DEEPSEEK_CONTEXT_TOKENS="1048576"
```

2. 建库并启动：

```bash
npx prisma migrate dev
npm run dev
```

3. 打开 http://localhost:3000 ，注册账号后即可对话。

## 人设与多对话

- 每次新建对话都会弹出人设窗口，可选 6 种预设（温柔学姐、严谨工程师、幽默损友、古典诗人、耐心老师、效率管家），
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
- `proxy.ts` 轻量路由守卫（仅检查会话 cookie，不做数据库访问）
- `app/api/chat/route.ts` DeepSeek SSE 流式接口（`convertToModelMessages` + `streamText` + 服务端解析人设）
- `app/api/conversations` 对话增删查，`app/api/conversations/[id]/messages` 消息写入与清空
- `app/api/auth/register` 注册
- `lib/auth.ts` Auth.js 配置，`lib/password.ts` Argon2id 哈希，`lib/personas.ts` 人设预设与系统提示词拼装
- `lib/usage.ts` 上下文窗口常量、token 估算与格式化
- `lib/archive.ts` 本地存档读写、回填、摘要与目录迁移
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

`tools/utf8-roundtrip-test.mjs` 是持久化中文往返的自检脚本（需服务已在 3000 端口运行）。
`tools/verify-persona.mjs` 覆盖人设注入、上下文裁剪后仍保留人设、清空上下文、跨用户隔离与删除对话（需 mock + 3000 端口服务）。
`tools/verify-usage.mjs` 覆盖 usage 随流下发、入库与页面回显（同样需要 mock + 3000 端口服务）。
`tools/verify-archive.mjs` 覆盖存档三文件、开关、晚开回填、自动读回、目录迁移、删文件与跨用户隔离。
