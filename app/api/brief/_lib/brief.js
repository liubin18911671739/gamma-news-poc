import Parser from "rss-parser";

const GAMMA_BASE = "https://public-api.gamma.app/v1.0";
const DEFAULT_KEYWORD = "人工智能 国别 政策";
const DEFAULT_RSS_URL = "https://news.google.com/rss/search?q=artificial%20intelligence&hl=en-US&gl=US&ceid=US:en";
const DEFAULT_LIMIT = 12;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getGammaApiKey = () => {
  const value = process.env.GAMMA_API_KEY;
  if (!value) {
    throw new Error("Missing GAMMA_API_KEY environment variable");
  }
  return value;
};

const asErrorMessage = (err) => {
  const text = err?.message || String(err);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

const toTimestamp = (value) => {
  const ts = Date.parse(value || "");
  return Number.isNaN(ts) ? -1 : ts;
};

const toUnique = (values) => {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
};

const toGoogleNewsRssUrl = (keyword) => {
  const params = new URLSearchParams({
    q: keyword,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
};

export function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  return clamp(parsed, 1, 20);
}

export function normalizeKeyword(value) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized || DEFAULT_KEYWORD;
}

export function normalizeRssUrls(value) {
  const lines = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(/[\n,]/)
      .map((part) => part.trim());

  const urls = [];
  const invalid = [];
  for (const line of lines) {
    const text = String(line || "").trim();
    if (!text) continue;
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        invalid.push(text);
        continue;
      }
      urls.push(parsed.toString());
    } catch {
      invalid.push(text);
    }
  }

  return {
    urls: toUnique(urls),
    invalid,
  };
}

function extractImageUrl(item) {
  if (item.enclosure?.url) return item.enclosure.url;

  const mediaContent = item["media:content"];
  if (Array.isArray(mediaContent) && mediaContent[0]?.$?.url) return mediaContent[0].$.url;
  if (mediaContent?.$?.url) return mediaContent.$.url;

  const mediaThumbnail = item["media:thumbnail"];
  if (Array.isArray(mediaThumbnail) && mediaThumbnail[0]?.$?.url) return mediaThumbnail[0].$.url;
  if (mediaThumbnail?.$?.url) return mediaThumbnail.$.url;

  const html = item.content || item.contentSnippet || "";
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || null;
}

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

async function fetchHeadlinesFromSource(parser, sourceUrl) {
  const feed = await parser.parseURL(sourceUrl);
  const items = (feed.items || []).map((item) => ({
    title: item.title?.trim() || "Untitled",
    link: item.link || "",
    source: feed.title || "RSS",
    date: item.isoDate || item.pubDate || "",
    imageUrl: extractImageUrl(item),
  }));
  return { items };
}

function dedupeHeadlines(items) {
  const linkSet = new Set();
  const titleDateSet = new Set();
  const deduped = [];

  for (const item of items) {
    const link = item.link?.trim();
    if (link) {
      if (linkSet.has(link)) continue;
      linkSet.add(link);
      deduped.push(item);
      continue;
    }

    const key = `${item.title?.trim()?.toLowerCase() || ""}__${item.date || ""}`;
    if (titleDateSet.has(key)) continue;
    titleDateSet.add(key);
    deduped.push(item);
  }

  return deduped;
}

export async function fetchHeadlines({ limit = DEFAULT_LIMIT, keyword, rssUrls } = {}) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const normalizedRss = normalizeRssUrls(rssUrls);
  const warnings = [];

  if (normalizedRss.invalid.length) {
    warnings.push(`以下 RSS 地址无效，已忽略：${normalizedRss.invalid.join("，")}`);
  }

  let generatedGoogleRssUrl = null;
  try {
    generatedGoogleRssUrl = toGoogleNewsRssUrl(normalizedKeyword);
  } catch {
    generatedGoogleRssUrl = null;
  }

  const effectiveSources = toUnique([
    generatedGoogleRssUrl,
    ...normalizedRss.urls,
  ]);

  if (!effectiveSources.length) {
    effectiveSources.push(process.env.RSS_URL || DEFAULT_RSS_URL);
    warnings.push("未提供可用 RSS 源，已回退到默认 RSS。");
  }

  const parser = new Parser();
  const tasks = effectiveSources.map((sourceUrl) =>
    fetchHeadlinesFromSource(parser, sourceUrl).then(
      (result) => ({ ok: true, sourceUrl, ...result }),
      (error) => ({ ok: false, sourceUrl, error }),
    ),
  );

  const settled = await Promise.all(tasks);
  const allItems = [];
  for (const item of settled) {
    if (item.ok) {
      allItems.push(...item.items);
      continue;
    }
    warnings.push(`RSS 源抓取失败（${item.sourceUrl}）：${asErrorMessage(item.error)}`);
  }

  const headlines = dedupeHeadlines(allItems)
    .sort((a, b) => toTimestamp(b.date) - toTimestamp(a.date))
    .slice(0, normalizeLimit(limit));

  return {
    headlines,
    warnings,
    effectiveSources,
    keyword: normalizedKeyword,
    rssUrls: normalizedRss.urls,
  };
}

export function buildGammaInputText(items, { keyword } = {}) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const today = new Date().toISOString().slice(0, 10);
  const cards = items.map((item, index) =>
    [
      `## ${index + 1}. ${item.title}`,
      item.date ? `*时间*: ${item.date}` : null,
      `*来源*: ${item.source}`,
      item.link ? `*链接*: ${item.link}` : null,
      item.imageUrl ? `*配图URL*: ${item.imageUrl}` : "*配图URL*: 无（请改用AI生成）",
      "*配图要求*: 为本条新闻生成一幅说明性AI图片（信息图/新闻插画风格），用于解释新闻重点。",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    "请严格使用简体中文输出所有标题与正文，不要使用英文段落。",
    `# Daily Industry Brief — ${today}`,
    `本期主题关键词：${normalizedKeyword}`,
    "",
    ...cards,
  ].join("\n---\n");
}

export async function gammaCreateWebpage({ inputText, keyword }) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const res = await fetch(`${GAMMA_BASE}/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": getGammaApiKey(),
      Accept: "application/json",
    },
    body: JSON.stringify({
      inputText,
      exportAs: "pdf",
      textMode: "preserve",
      format: "social",
      cardOptions: {
        dimensions: "4x5",
      },
      cardSplit: "inputTextBreaks",
      sharingOptions: { externalAccess: "view" },
      imageOptions: {
        source: "aiGenerated",
        model: "flux-2-pro",
        style: "editorial news illustration, clean modern, tech-focused, high contrast",
      },
      additionalInstructions:
        `Output all content in Simplified Chinese. Organize the brief around this topic keyword: ${normalizedKeyword}. Create region/country-focused social cards in a clean news style with a 4:5 layout. Every single news card must include exactly one explanatory image. Use the provided image URL as the real image whenever available; if missing or invalid, generate one relevant AI image using flux-2-pro. Keep each card short and scannable.`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Gamma POST failed: ${res.status} ${await res.text()}`);
  }

  const payload = await res.json();
  if (!payload.generationId) {
    throw new Error(`No generationId in response: ${JSON.stringify(payload)}`);
  }
  return payload.generationId;
}

export async function gammaGetGeneration(generationId) {
  const res = await fetch(`${GAMMA_BASE}/generations/${generationId}`, {
    headers: {
      "X-API-KEY": getGammaApiKey(),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Gamma GET failed: ${res.status} ${await res.text()}`);
  }

  const payload = await res.json();
  const status = payload.status || payload.finalResult?.status || "processing";
  const gammaUrl = payload.gammaUrl || payload.finalResult?.gammaUrl || payload.url || payload.finalResult?.url || null;
  const progressRaw = payload.progress ?? payload.finalResult?.progress;
  const progress = typeof progressRaw === "number" ? clamp(Math.round(progressRaw), 0, 100) : status === "completed" ? 100 : 50;
  const error = payload.error || payload.finalResult?.error || null;

  return {
    status,
    progress,
    gammaUrl,
    pdfUrl: extractPdfUrl(payload),
    error,
  };
}

export async function fetchGammaOgImage(gammaUrl) {
  if (!gammaUrl) return null;
  try {
    const res = await fetch(gammaUrl, { headers: { Accept: "text/html" }, cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}
