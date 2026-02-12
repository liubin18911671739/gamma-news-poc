# Gamma News Brief (Next.js)

将原有 Node 脚本重构为 Next.js 应用，可直接部署到 Vercel。

## 功能

- 关键词驱动的主题简报生成（关键词同时影响抓取与生成）
- 中文关键词自动翻译为英文后用于 RSS 搜索（智谱清言 API）
- 每条新闻进行联网扩展（原文 + 相关新闻）并提炼事实级补充
- 支持临时添加多个 RSS 源（每行一个 URL）
- 抓取 Google News RSS 新闻并与自定义 RSS 聚合去重
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
如需开启“中文关键词翻译为英文后搜索”，再填写 `ZHIPUAI_API_KEY`。
如需开启联网扩展事实提炼，复用 `ZHIPUAI_API_KEY` 即可（可选覆盖模型参数）。

3. 启动开发环境

```bash
npm run dev
```

访问 `http://localhost:3000`。

## 部署到 Vercel

1. 将仓库导入 Vercel
2. 在 Vercel Project Settings -> Environment Variables 配置：
   - `GAMMA_API_KEY`（必填）
   - `ZHIPUAI_API_KEY`（可选，用于中文关键词翻译）
   - `ZHIPU_TRANSLATE_MODEL`（可选，默认 `glm-4-flash`）
   - `ZHIPU_TRANSLATE_TIMEOUT_MS`（可选，默认 `5000`）
   - `ENRICH_FACTS_PER_ITEM`（可选，默认 `2`）
   - `ENRICH_RELATED_LIMIT`（可选，默认 `3`）
   - `ENRICH_CONCURRENCY`（可选，默认 `3`）
   - `ENRICH_FETCH_TIMEOUT_MS`（可选，默认 `4500`）
   - `ZHIPU_ENRICH_MODEL`（可选，默认 `glm-4-flash`）
   - `ZHIPU_ENRICH_TIMEOUT_MS`（可选，默认 `7000`）
   - `RSS_URL`（可选）
3. 使用默认构建设置：
   - Build Command: `npm run build`
   - Output: Next.js 默认输出

部署完成后即可使用页面触发生成任务。

## API

- `POST /api/brief/start`
  - Body:
    ```json
    {
      "limit": 12,
      "keyword": "artificial intelligence geopolitics regional policy",
      "rssUrls": ["https://example.com/feed.xml", "https://another.com/rss"]
    }
    ```
  - 返回：`generationId`、抓取到的新闻列表、`requestConfig`、`warnings`
  - `requestConfig` 关键字段：
    - `keyword`：原始关键词
    - `translatedKeyword`：翻译后的关键词
    - `searchKeyword`：实际用于 RSS 搜索的关键词
    - `translationApplied`：是否成功应用翻译
    - `enrichmentApplied`：是否应用联网扩展
    - `enrichedCount`：完成扩展的新闻条数
    - `enrichmentMode`：扩展模式（`article_plus_related_rss`）
    - `enrichmentFactCountPerItem`：每条扩展事实数量
  - `headlines` 每项新增：
    - `expandedFacts`: `[{ fact, sources:[{ title, url }] }]`
    - `enrichmentWarning`: 扩展失败时的降级提示

- `GET /api/brief/status?generationId=...`
  - 返回：`status/progress/gammaUrl/pdfUrl/heroImageUrl`
