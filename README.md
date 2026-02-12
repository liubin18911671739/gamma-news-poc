# Gamma News Brief (Next.js)

将原有 Node 脚本重构为 Next.js 应用，可直接部署到 Vercel。

## 功能

- 抓取 Google News RSS 新闻
- 调用 Gamma API 生成新闻简报页面
- 轮询任务状态并返回 `gammaUrl` / `pdfUrl`
- 前端页面展示生成结果和封面图

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env.local
```

填写 `GAMMA_API_KEY`。

3. 启动开发环境

```bash
npm run dev
```

访问 `http://localhost:3000`。

## 部署到 Vercel

1. 将仓库导入 Vercel
2. 在 Vercel Project Settings -> Environment Variables 配置：
   - `GAMMA_API_KEY`（必填）
   - `RSS_URL`（可选）
3. 使用默认构建设置：
   - Build Command: `npm run build`
   - Output: Next.js 默认输出

部署完成后即可使用页面触发生成任务。

## API

- `POST /api/brief/start`
  - Body: `{ "limit": 12 }`
  - 返回：`generationId` 与抓取到的新闻列表

- `GET /api/brief/status?generationId=...`
  - 返回：`status/progress/gammaUrl/pdfUrl/heroImageUrl`
