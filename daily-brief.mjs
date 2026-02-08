import Parser from 'rss-parser';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const GAMMA_API_KEY = process.env.GAMMA_API_KEY;
if (!GAMMA_API_KEY) throw new Error('Missing GAMMA_API_KEY in OS environment variables');

const GAMMA_BASE = 'https://public-api.gamma.app/v1.0';
const RSS_URL =
  'https://news.google.com/rss/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%20%E5%9B%BD%E5%88%AB%20%E5%9C%B0%E5%8C%BA%20%E6%94%BF%E7%AD%96&hl=zh-CN&gl=CN&ceid=CN:zh-Hans';
const __dirname = dirname(fileURLToPath(import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractPdfUrl(payload) {
  if (!payload) return null;
  return (
    payload.file_url ||
    payload.pdfUrl ||
    payload.fileUrl ||
    payload.exportUrl ||
    payload.downloadUrl ||
    payload?.files?.pdf ||
    payload?.files?.pdfUrl ||
    payload?.exports?.pdf ||
    payload?.exports?.pdfUrl ||
    payload?.exports?.pdf?.url ||
    payload?.finalResult?.file_url ||
    payload?.finalResult?.pdfUrl ||
    payload?.finalResult?.fileUrl ||
    payload?.finalResult?.exportUrl ||
    payload?.finalResult?.downloadUrl ||
    payload?.finalResult?.files?.pdf ||
    payload?.finalResult?.files?.pdfUrl ||
    payload?.finalResult?.exports?.pdf ||
    payload?.finalResult?.exports?.pdfUrl ||
    payload?.finalResult?.exports?.pdf?.url ||
    null
  );
}

function extractImageUrl(item) {
  if (item.enclosure?.url) return item.enclosure.url;

  const mediaContent = item['media:content'];
  if (Array.isArray(mediaContent) && mediaContent[0]?.$?.url) return mediaContent[0].$.url;
  if (mediaContent?.$?.url) return mediaContent.$.url;

  const mediaThumbnail = item['media:thumbnail'];
  if (Array.isArray(mediaThumbnail) && mediaThumbnail[0]?.$?.url) return mediaThumbnail[0].$.url;
  if (mediaThumbnail?.$?.url) return mediaThumbnail.$.url;

  const html = item.content || item.contentSnippet || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || null;
}

async function fetchHeadlines({ limit = 12 } = {}) {
  const parser = new Parser();
  const feed = await parser.parseURL(RSS_URL);

  return (feed.items || [])
    .slice(0, limit)
    .map((it) => ({
      title: it.title?.trim() || 'Untitled',
      link: it.link,
      source: feed.title || 'RSS',
      date: it.isoDate || it.pubDate || '',
      imageUrl: extractImageUrl(it),
    }));
}

function buildGammaInputText(items) {
  const today = new Date().toISOString().slice(0, 10);

  const cards = items.map((x, idx) => {
    // 每条新闻一个“卡片/板块”
    return [
      `## ${idx + 1}. ${x.title}`,
      x.date ? `*时间*: ${x.date}` : null,
      `*来源*: ${x.source}`,
      x.link ? `*链接*: ${x.link}` : null,
      x.imageUrl ? `*配图URL*: ${x.imageUrl}` : '*配图URL*: 无（请改用AI生成）',
      '*配图要求*: 为本条新闻生成一幅说明性AI图片（信息图/新闻插画风格），用于解释新闻重点。',
    ]
      .filter(Boolean)
      .join('\n');
  });

  // 用 \n---\n 做卡片分隔
  return [
    '请严格使用简体中文输出所有标题与正文，不要使用英文段落。',
    `# Daily Industry Brief — ${today}`,
    '',
    ...cards,
  ].join('\n---\n');
}

async function gammaCreateWebpage({ inputText }) {
  // POST /generations :contentReference[oaicite:4]{index=4}
  const res = await fetch(`${GAMMA_BASE}/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': GAMMA_API_KEY, // :contentReference[oaicite:5]{index=5}
      Accept: 'application/json',
    },
    body: JSON.stringify({
      inputText,
      exportAs: 'pdf',
      textMode: 'preserve',              // 保留你给的标题结构 :contentReference[oaicite:6]{index=6}
      format: 'social',                  // 社交卡片
      cardOptions: {
        dimensions: '4x5',               // 4:5 比例
      },
      cardSplit: 'inputTextBreaks',      // 按 \n---\n 切卡片 :contentReference[oaicite:8]{index=8}
      sharingOptions: { externalAccess: 'view' }, // 外部可访问 :contentReference[oaicite:9]{index=9}
      // 网站需要配图：开启 AI 生成图片
      imageOptions: {
        source: 'aiGenerated',
        model: 'flux-2-pro',
        style: 'editorial news illustration, clean modern, tech-focused, high contrast',
      },
      additionalInstructions:
        'Output all content in Simplified Chinese. Create region/country-focused social cards in a clean news style with a 4:5 layout. Every single news card must include exactly one explanatory image. Use the provided image URL as the real image whenever available; if missing or invalid, generate one relevant AI image using flux-2-pro. Keep each card short and scannable.',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gamma POST failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (!data.generationId) throw new Error(`No generationId in response: ${JSON.stringify(data)}`);
  return data.generationId;
}

async function gammaPollResult(generationId, { intervalMs = 2500, maxTries = 120 } = {}) {
  // GET /generations/{generationId} :contentReference[oaicite:10]{index=10}
  for (let i = 0; i < maxTries; i++) {
    const res = await fetch(`${GAMMA_BASE}/generations/${generationId}`, {
      headers: { 'X-API-KEY': GAMMA_API_KEY, Accept: 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gamma GET failed: ${res.status} ${text}`);
    }

    const data = await res.json();

    // 兼容不同返回结构（一些环境会把最终结果放在 finalResult 里）
    const status = data.status || data.finalResult?.status;
    const gammaUrl = data.gammaUrl || data.finalResult?.gammaUrl || data.url || data.finalResult?.url;
    const pdfUrl = extractPdfUrl(data);
    const error = data.error || data.finalResult?.error;
    const progressRaw = data.progress ?? data.finalResult?.progress;
    const progress =
      typeof progressRaw === 'number'
        ? Math.max(0, Math.min(99, Math.round(progressRaw)))
        : Math.max(1, Math.min(99, Math.round(((i + 1) / maxTries) * 100)));

    process.stdout.write(`\r⏳ 生成进度: ${String(progress).padStart(2, ' ')}% | 状态: ${status || 'processing'}   `);

    if (status === 'completed' && gammaUrl) {
      process.stdout.write('\r⏳ 生成进度: 100% | 状态: completed                      \n');
      return { status, gammaUrl, pdfUrl, raw: data };
    }
    if (status === 'failed') throw new Error(`Gamma generation failed: ${error || JSON.stringify(data)}`);

    await sleep(intervalMs);
  }
  process.stdout.write('\n');
  throw new Error(`Polling timeout: generationId=${generationId}`);
}

function buildPortalHtml({ gammaUrl, pdfUrl }) {
  const actionButtons = pdfUrl
    ? `<div style="display:flex;gap:12px;"><a class="btn btn-primary" href="${gammaUrl}" target="_blank" rel="noopener noreferrer">浏览新闻列表</a><a class="btn btn-secondary" href="${pdfUrl}" target="_blank" rel="noopener noreferrer" download>导出为 PDF</a></div>`
    : `<div style="display:flex;gap:12px;"><a class="btn btn-primary" href="${gammaUrl}" target="_blank" rel="noopener noreferrer">浏览新闻列表</a><button class="btn btn-disabled" disabled>导出为 PDF（不可用）</button></div>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>新闻简报门户</title>
  <style>
    :root { --bg:#f5f7fb; --card:#ffffff; --text:#111827; --primary:#0b6bcb; --secondary:#0f766e; --muted:#6b7280; }
    body { margin:0; font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif; color:var(--text); background:linear-gradient(160deg,#eef4ff,#f8fbff 40%,#eefbf7); }
    .wrap { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
    .card { background:var(--card); border-radius:16px; box-shadow: 0 8px 28px rgba(0,0,0,.08); overflow:hidden; }
    .top { padding:20px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
    .title { font-size:20px; font-weight:700; margin-right:auto; }
    .btn { text-decoration:none; border:0; border-radius:10px; padding:10px 14px; color:#fff; font-weight:600; cursor:pointer; display:inline-block; }
    .btn-primary { background:var(--primary); }
    .btn-secondary { background:var(--secondary); }
    .btn-disabled { background:var(--muted); color:#fff; cursor:not-allowed; }
    iframe { width:100%; height:78vh; border:0; background:#fff; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="top">
        <div class="title">AI 区域国别新闻简报</div>
        ${actionButtons}
      </div>
      <iframe src="${gammaUrl}" title="Gamma News"></iframe>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  console.log('📰 正在抓取 RSS 新闻...');
  const headlines = await fetchHeadlines({ limit: 12 });
  if (!headlines.length) throw new Error('No headlines fetched');
  console.log(`✅ 已抓取 ${headlines.length} 条新闻`);

  const inputText = buildGammaInputText(headlines);
  console.log('🚀 正在提交 Gamma 生成任务...');
  const generationId = await gammaCreateWebpage({ inputText });
  console.log(`🆔 generationId: ${generationId}`);
  const result = await gammaPollResult(generationId);
  let pdfUrl = result.pdfUrl;

  // 某些版本会在 completed 后稍晚返回导出链接，这里补充重试。
  if (!pdfUrl) {
    for (let i = 0; i < 6; i++) {
      await sleep(2000);
      const retry = await fetch(`${GAMMA_BASE}/generations/${generationId}`, {
        headers: { 'X-API-KEY': GAMMA_API_KEY, Accept: 'application/json' },
      });
      if (!retry.ok) continue;
      const retryData = await retry.json();
      pdfUrl = extractPdfUrl(retryData);
      if (pdfUrl) break;
    }
  }

  console.log('\n✅ Gamma 页面已生成:');
  console.log(result.gammaUrl);
  if (pdfUrl) {
    console.log('\n📥 导出 PDF:');
    console.log(pdfUrl);
    console.log('⚠️ PDF 链接通常有时效性，请尽快下载。');
    console.log('\n🧩 网页按钮片段（右侧为“导出为 PDF”）:');
    console.log(
      `<div style="display:flex;gap:12px;">` +
      `<a href="${result.gammaUrl}" target="_blank" rel="noopener noreferrer">浏览新闻列表</a>` +
      `<a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" download>导出为 PDF</a>` +
      `</div>`,
    );
  } else {
    console.log('\nℹ️ 未返回 PDF 下载链接，请检查 raw 字段（file_url / pdfUrl / fileUrl）。');
  }

  const portalPath = join(__dirname, 'news-portal.html');
  await writeFile(portalPath, buildPortalHtml({ gammaUrl: result.gammaUrl, pdfUrl }), 'utf8');
  console.log(`\n🌐 已生成本地门户网页: ${portalPath}`);
}

main().catch((e) => {
  console.error('\n❌ ERROR');
  console.error(e);
  process.exit(1);
});
