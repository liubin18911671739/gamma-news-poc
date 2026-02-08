import Parser from 'rss-parser';

const GAMMA_API_KEY = process.env.GAMMA_API_KEY;
if (!GAMMA_API_KEY) throw new Error('Missing GAMMA_API_KEY in OS environment variables');

const GAMMA_BASE = 'https://public-api.gamma.app/v1.0';
const RSS_URL =
  'https://news.google.com/rss/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%20%E5%9B%BD%E5%88%AB%20%E5%9C%B0%E5%8C%BA%20%E6%94%BF%E7%AD%96&hl=zh-CN&gl=CN&ceid=CN:zh-Hans';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    ]
      .filter(Boolean)
      .join('\n');
  });

  // 用 \n---\n 做卡片分隔
  return [
    '请严格使用简体中文输出所有标题与正文，不要使用英文段落。',
    `# Daily Industry Brief — ${today}`,
    `更新：自动抓取 RSS 标题并生成 Gamma 网页`,
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
      textMode: 'preserve',              // 保留你给的标题结构 :contentReference[oaicite:6]{index=6}
      format: 'webpage',                 // 网页 :contentReference[oaicite:7]{index=7}
      cardSplit: 'inputTextBreaks',      // 按 \n---\n 切卡片 :contentReference[oaicite:8]{index=8}
      sharingOptions: { externalAccess: 'view' }, // 外部可访问 :contentReference[oaicite:9]{index=9}
      // 网站需要配图：开启 AI 生成图片
      imageOptions: {
        source: 'aiGenerated',
        model: 'flux-2-pro',
        style: 'editorial news illustration, clean modern, tech-focused, high contrast',
      },
      additionalInstructions:
        'Output the entire webpage in Simplified Chinese. Build a region/country-focused AI news microsite with a compact table of contents. For each news card, use the provided image URL as the real image whenever available; if missing or invalid, generate one relevant AI image using flux-2-pro. Keep each card short and scannable.',
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
    const gammaUrl = data.gammaUrl || data.finalResult?.gammaUrl;
    const error = data.error || data.finalResult?.error;
    const progressRaw = data.progress ?? data.finalResult?.progress;
    const progress =
      typeof progressRaw === 'number'
        ? Math.max(0, Math.min(99, Math.round(progressRaw)))
        : Math.max(1, Math.min(99, Math.round(((i + 1) / maxTries) * 100)));

    process.stdout.write(`\r⏳ 生成进度: ${String(progress).padStart(2, ' ')}% | 状态: ${status || 'processing'}   `);

    if (status === 'completed' && gammaUrl) {
      process.stdout.write('\r⏳ 生成进度: 100% | 状态: completed                      \n');
      return { status, gammaUrl, raw: data };
    }
    if (status === 'failed') throw new Error(`Gamma generation failed: ${error || JSON.stringify(data)}`);

    await sleep(intervalMs);
  }
  process.stdout.write('\n');
  throw new Error(`Polling timeout: generationId=${generationId}`);
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

  console.log('\n✅ Gamma microsite ready:');
  console.log(result.gammaUrl);
}

main().catch((e) => {
  console.error('\n❌ ERROR');
  console.error(e);
  process.exit(1);
});
