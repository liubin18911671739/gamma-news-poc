import Parser from "rss-parser";
import { ZhipuAI } from "zhipuai-sdk-nodejs-v4";

const GAMMA_BASE = "https://public-api.gamma.app/v1.0";
const DEFAULT_KEYWORD = "artificial intelligence geopolitics regional policy";
const DEFAULT_RSS_URL =
  "https://news.google.com/rss/search?q=artificial%20intelligence%20geopolitics%20regional%20policy&hl=en-US&gl=US&ceid=US:en";
const DEFAULT_LIMIT = 12;
const DEFAULT_TRANSLATE_MODEL = "glm-4-flash";
const DEFAULT_TRANSLATE_TIMEOUT_MS = 5000;
const DEFAULT_ENRICH_FACTS_PER_ITEM = 2;
const DEFAULT_ENRICH_RELATED_LIMIT = 3;
const DEFAULT_ENRICH_CONCURRENCY = 3;
const DEFAULT_ENRICH_FETCH_TIMEOUT_MS = 4500;
const DEFAULT_ENRICH_MODEL = "glm-4-flash";
const DEFAULT_ENRICH_TIMEOUT_MS = 15000;
const DEFAULT_CORE_SEARCH_RELATED_LIMIT = 3;
const DEFAULT_CORE_SEARCH_CONCURRENCY = 3;
const DEFAULT_NEWS_POOL_MAX_ITEMS = 60;
const ENRICHMENT_MODE = "article_plus_related_rss";
const ENRICHMENT_SNIPPET_LIMIT = 1800;
const ENRICHMENT_EVIDENCE_LIMIT = 2600;
const CARD_SNIPPET_LIMIT = 500;
const CHINESE_CHAR_REGEX = /[\u3400-\u9FFF]/;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getGammaApiKey = () => {
  const value = process.env.GAMMA_API_KEY;
  if (!value) {
    throw new Error("Missing GAMMA_API_KEY environment variable");
  }
  return value;
};

const getZhipuApiKey = () => String(process.env.ZHIPUAI_API_KEY ?? "").trim();

const getTranslateModel = () => String(process.env.ZHIPU_TRANSLATE_MODEL ?? "").trim() || DEFAULT_TRANSLATE_MODEL;

const getTranslateTimeoutMs = () => {
  const parsed = Number.parseInt(String(process.env.ZHIPU_TRANSLATE_TIMEOUT_MS ?? DEFAULT_TRANSLATE_TIMEOUT_MS), 10);
  if (Number.isNaN(parsed)) return DEFAULT_TRANSLATE_TIMEOUT_MS;
  return clamp(parsed, 1000, 20000);
};

const getEnrichFactsPerItem = () => {
  const parsed = Number.parseInt(String(process.env.ENRICH_FACTS_PER_ITEM ?? DEFAULT_ENRICH_FACTS_PER_ITEM), 10);
  if (Number.isNaN(parsed)) return DEFAULT_ENRICH_FACTS_PER_ITEM;
  return clamp(parsed, 1, 6);
};

const getEnrichRelatedLimit = () => {
  const parsed = Number.parseInt(String(process.env.ENRICH_RELATED_LIMIT ?? DEFAULT_ENRICH_RELATED_LIMIT), 10);
  if (Number.isNaN(parsed)) return DEFAULT_ENRICH_RELATED_LIMIT;
  return clamp(parsed, 1, 8);
};

const getEnrichConcurrency = () => {
  const parsed = Number.parseInt(String(process.env.ENRICH_CONCURRENCY ?? DEFAULT_ENRICH_CONCURRENCY), 10);
  if (Number.isNaN(parsed)) return DEFAULT_ENRICH_CONCURRENCY;
  return clamp(parsed, 1, 8);
};

const getEnrichFetchTimeoutMs = () => {
  const parsed = Number.parseInt(String(process.env.ENRICH_FETCH_TIMEOUT_MS ?? DEFAULT_ENRICH_FETCH_TIMEOUT_MS), 10);
  if (Number.isNaN(parsed)) return DEFAULT_ENRICH_FETCH_TIMEOUT_MS;
  return clamp(parsed, 1000, 20000);
};

const getEnrichModel = () => String(process.env.ZHIPU_ENRICH_MODEL ?? "").trim() || DEFAULT_ENRICH_MODEL;

const getEnrichTimeoutMs = () => {
  const parsed = Number.parseInt(String(process.env.ZHIPU_ENRICH_TIMEOUT_MS ?? DEFAULT_ENRICH_TIMEOUT_MS), 10);
  if (Number.isNaN(parsed)) return DEFAULT_ENRICH_TIMEOUT_MS;
  return clamp(parsed, 1000, 30000);
};

const getCoreSearchRelatedLimit = () => {
  const parsed = Number.parseInt(String(process.env.CORE_SEARCH_RELATED_LIMIT ?? DEFAULT_CORE_SEARCH_RELATED_LIMIT), 10);
  if (Number.isNaN(parsed)) return DEFAULT_CORE_SEARCH_RELATED_LIMIT;
  return clamp(parsed, 1, 6);
};

const getCoreSearchConcurrency = () => {
  const parsed = Number.parseInt(String(process.env.CORE_SEARCH_CONCURRENCY ?? DEFAULT_CORE_SEARCH_CONCURRENCY), 10);
  if (Number.isNaN(parsed)) return DEFAULT_CORE_SEARCH_CONCURRENCY;
  return clamp(parsed, 1, 8);
};

const getNewsPoolMaxItems = () => {
  const parsed = Number.parseInt(String(process.env.NEWS_POOL_MAX_ITEMS ?? DEFAULT_NEWS_POOL_MAX_ITEMS), 10);
  if (Number.isNaN(parsed)) return DEFAULT_NEWS_POOL_MAX_ITEMS;
  return clamp(parsed, 10, 120);
};

const asErrorMessage = (err) => {
  const text = err?.message || String(err);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

const isTimeoutError = (err) => {
  const text = asErrorMessage(err).toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("exceeded") ||
    err?.code === "ECONNABORTED"
  );
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

export function containsChinese(text) {
  return CHINESE_CHAR_REGEX.test(String(text ?? ""));
}

function sanitizeTranslatedKeyword(value) {
  const text = String(value ?? "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
  return text;
}

function sanitizeFactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripHtmlToText(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonObject(text) {
  const cleaned = String(text ?? "").replace(/```json|```/gi, "").trim();
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const maybeJson = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(maybeJson);
    } catch {
      return null;
    }
  }
}

function normalizeUrlForMatch(value) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

async function runWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  const maxWorkers = Math.min(Math.max(1, concurrency), items.length);
  let cursor = 0;

  async function loop() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, () => loop()));
  return results;
}

function buildCorePrompt(item) {
  const facts = Array.isArray(item?.expandedFacts) ? item.expandedFacts : [];
  const factText = facts
    .slice(0, 2)
    .map((fact) => sanitizeFactText(fact?.fact))
    .filter(Boolean)
    .join(" ; ");
  const title = sanitizeFactText(item?.title);
  const summary = sanitizeFactText(item?.articleSnippet || "").slice(0, 220);
  return [title, factText, summary].filter(Boolean).join(" | ");
}

function toMessageText(content) {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part?.text === "string") return part.text;
        return "";
      })
      .join(" ")
      .trim();
  }
  return String(content ?? "").trim();
}

export async function translateKeywordForSearch(keyword) {
  const originalKeyword = normalizeKeyword(keyword);

  if (!containsChinese(originalKeyword)) {
    return {
      originalKeyword,
      translatedKeyword: originalKeyword,
      searchKeyword: originalKeyword,
      translationApplied: false,
    };
  }

  const apiKey = getZhipuApiKey();
  if (!apiKey) {
    return {
      originalKeyword,
      translatedKeyword: originalKeyword,
      searchKeyword: originalKeyword,
      translationApplied: false,
      warning: "检测到中文关键词，但未配置 ZHIPUAI_API_KEY，已回退为原关键词搜索。",
    };
  }

  try {
    const client = new ZhipuAI({
      apiKey,
      timeout: getTranslateTimeoutMs(),
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    });
    const response = await client.createCompletions({
      model: getTranslateModel(),
      stream: false,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You translate Chinese search keywords into concise English search phrases. Return only the translated phrase, no explanations, no quotes.",
        },
        { role: "user", content: originalKeyword },
      ],
    });

    const rawText = toMessageText(response?.choices?.[0]?.message?.content);
    const translatedKeyword = sanitizeTranslatedKeyword(rawText);

    if (!translatedKeyword) {
      return {
        originalKeyword,
        translatedKeyword: originalKeyword,
        searchKeyword: originalKeyword,
        translationApplied: false,
        warning: "关键词翻译结果为空，已回退为原关键词搜索。",
      };
    }

    return {
      originalKeyword,
      translatedKeyword,
      searchKeyword: translatedKeyword,
      translationApplied: true,
    };
  } catch (error) {
    return {
      originalKeyword,
      translatedKeyword: originalKeyword,
      searchKeyword: originalKeyword,
      translationApplied: false,
      warning: `关键词翻译失败（${asErrorMessage(error)}），已回退为原关键词搜索。`,
    };
  }
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

export async function fetchArticleSnippet(url, { timeoutMs = getEnrichFetchTimeoutMs() } = {}) {
  const targetUrl = String(url ?? "").trim();
  if (!targetUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("fetch-timeout"), timeoutMs);

  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = stripHtmlToText(html);
    if (!text) return null;
    return text.slice(0, ENRICHMENT_SNIPPET_LIMIT);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchRelatedNewsByRss({ title, keyword, limit = getEnrichRelatedLimit() } = {}) {
  const query = [String(title ?? "").trim(), String(keyword ?? "").trim()].filter(Boolean).join(" ");
  if (!query) return [];

  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  const rssUrl = `https://news.google.com/rss/search?${params.toString()}`;
  const parser = new Parser();

  try {
    const feed = await parser.parseURL(rssUrl);
    return (feed.items || [])
      .slice(0, limit)
      .map((item) => ({
        title: item.title?.trim() || "Untitled",
        link: item.link || "",
        source: feed.title || "Google News RSS",
        date: item.isoDate || item.pubDate || "",
      }));
  } catch {
    return [];
  }
}

export async function buildEvidenceBundle(item, { keyword, relatedLimit, fetchTimeoutMs } = {}) {
  const [articleSnippet, relatedNewsRaw] = await Promise.all([
    fetchArticleSnippet(item.link, { timeoutMs: fetchTimeoutMs }),
    searchRelatedNewsByRss({ title: item.title, keyword, limit: relatedLimit }),
  ]);

  const baseUrl = normalizeUrlForMatch(item.link);
  const seen = new Set(baseUrl ? [baseUrl] : []);
  const relatedNews = [];
  for (const rel of relatedNewsRaw) {
    const normalized = normalizeUrlForMatch(rel.link);
    if (normalized && seen.has(normalized)) continue;
    if (normalized) seen.add(normalized);
    relatedNews.push(rel);
  }

  const sourceCandidates = [];
  if (item.link) {
    sourceCandidates.push({ title: item.title, url: item.link, source: item.source });
  }
  for (const rel of relatedNews) {
    if (!rel.link) continue;
    sourceCandidates.push({
      title: rel.title,
      url: rel.link,
      source: rel.source,
    });
  }

  const evidenceParts = [];
  if (articleSnippet) {
    evidenceParts.push(`原文摘要：${articleSnippet}`);
  }
  if (relatedNews.length) {
    evidenceParts.push(
      "相关新闻候选：\n" +
        relatedNews
          .map((news, idx) => `${idx + 1}. ${news.title} | 来源: ${news.source} | 链接: ${news.link}`)
          .join("\n"),
    );
  }

  return {
    articleSnippet,
    relatedNews,
    sourceCandidates,
    evidenceText: evidenceParts.join("\n\n").trim(),
  };
}

export async function extractFactsWithZhipu({ item, evidence, factCount }) {
  const apiKey = getZhipuApiKey();
  if (!apiKey) {
    return {
      facts: [],
      warning: "未配置 ZHIPUAI_API_KEY，无法进行联网事实扩展。",
    };
  }
  if (!evidence?.evidenceText) {
    return {
      facts: [],
      warning: "未获取到足够证据，跳过联网扩展。",
    };
  }

  const allowedSources = new Map();
  for (const source of evidence.sourceCandidates || []) {
    const normalized = normalizeUrlForMatch(source.url);
    if (!normalized) continue;
    allowedSources.set(normalized, {
      title: source.title || source.url,
      url: source.url,
    });
  }

  const client = new ZhipuAI({
    apiKey,
    timeout: getEnrichTimeoutMs(),
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  });

  let parsed = null;
  let lastError = null;
  const evidenceText = String(evidence.evidenceText || "").slice(0, ENRICHMENT_EVIDENCE_LIMIT);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.createCompletions({
        model: getEnrichModel(),
        stream: false,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "你是新闻研究助理。请严格输出 JSON，不要 markdown。格式为 {\"facts\":[{\"fact\":\"...\",\"sources\":[{\"title\":\"...\",\"url\":\"...\"}]}]}。仅可使用给定证据中的来源 URL，不可编造来源。",
          },
          {
            role: "user",
            content: `新闻标题：${item.title}\n新闻链接：${item.link || "N/A"}\n\n证据：\n${evidenceText}`,
          },
        ],
      });
      const rawText = toMessageText(response?.choices?.[0]?.message?.content);
      const maybe = extractJsonObject(rawText);
      if (maybe && Array.isArray(maybe.facts)) {
        parsed = maybe;
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!parsed || !Array.isArray(parsed.facts)) {
    if (lastError) {
      if (isTimeoutError(lastError)) {
        return {
          facts: [],
          warning: `联网扩展请求超时（>${getEnrichTimeoutMs()}ms），已回退原始信息。可在环境变量中提高 ZHIPU_ENRICH_TIMEOUT_MS。`,
        };
      }
      return {
        facts: [],
        warning: `联网扩展请求失败（${asErrorMessage(lastError)}），已回退原始信息。`,
      };
    }
    return {
      facts: [],
      warning: "联网扩展模型返回格式无效，已回退原始信息。",
    };
  }

  const normalizedFacts = [];
  for (const rawFact of parsed.facts) {
    const factText = sanitizeFactText(rawFact?.fact);
    if (!factText) continue;

    const sourceList = [];
    const sources = Array.isArray(rawFact?.sources) ? rawFact.sources : [];
    for (const source of sources) {
      const normalizedUrl = normalizeUrlForMatch(source?.url);
      if (!normalizedUrl) continue;
      const matched = allowedSources.get(normalizedUrl);
      if (!matched) continue;
      sourceList.push({
        title: sanitizeFactText(source?.title) || matched.title,
        url: matched.url,
      });
    }

    const dedupedSources = [];
    const seenUrls = new Set();
    for (const source of sourceList) {
      if (seenUrls.has(source.url)) continue;
      seenUrls.add(source.url);
      dedupedSources.push(source);
    }

    if (!dedupedSources.length) continue;
    normalizedFacts.push({
      fact: factText,
      sources: dedupedSources,
    });
  }

  return {
    facts: normalizedFacts.slice(0, factCount),
    warning: normalizedFacts.length ? null : "未提炼出可验证的扩展事实，已回退原始信息。",
  };
}

async function fetchHeadlinesFromSource(parser, sourceUrl) {
  const feed = await parser.parseURL(sourceUrl);
  const items = (feed.items || []).map((item) => ({
    title: item.title?.trim() || "Untitled",
    link: item.link || "",
    source: feed.title || "RSS",
    date: item.isoDate || item.pubDate || "",
    imageUrl: extractImageUrl(item),
    expandedFacts: [],
    enrichmentWarning: null,
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

async function enrichOneHeadline(item, config) {
  try {
    const evidence = await buildEvidenceBundle(item, {
      keyword: config.keyword,
      relatedLimit: config.relatedLimit,
      fetchTimeoutMs: config.fetchTimeoutMs,
    });
    if (!evidence.evidenceText) {
      return {
        ...item,
        articleSnippet: null,
        expandedFacts: [],
        enrichmentWarning: "未获取到足够的联网证据，已使用原始信息生成。",
      };
    }

    const enriched = await extractFactsWithZhipu({
      item,
      evidence,
      factCount: config.factCount,
    });

    if (!enriched.facts.length) {
      return {
        ...item,
        articleSnippet: evidence.articleSnippet ? evidence.articleSnippet.slice(0, CARD_SNIPPET_LIMIT) : null,
        expandedFacts: [],
        enrichmentWarning: enriched.warning || "联网扩展失败，已使用原始信息生成。",
      };
    }

    return {
      ...item,
      articleSnippet: evidence.articleSnippet ? evidence.articleSnippet.slice(0, CARD_SNIPPET_LIMIT) : null,
      expandedFacts: enriched.facts,
      enrichmentWarning: enriched.warning || null,
    };
  } catch (error) {
    return {
      ...item,
      articleSnippet: null,
      expandedFacts: [],
      enrichmentWarning: `联网扩展异常（${asErrorMessage(error)}），已使用原始信息生成。`,
    };
  }
}

export async function enrichHeadlines(items, { keyword, factCount, relatedLimit, concurrency } = {}) {
  const inputItems = Array.isArray(items) ? items : [];
  const normalizedKeyword = normalizeKeyword(keyword);
  const resolvedFactCount = clamp(Number(factCount ?? getEnrichFactsPerItem()), 1, 6);
  const resolvedRelatedLimit = clamp(Number(relatedLimit ?? getEnrichRelatedLimit()), 1, 8);
  const resolvedConcurrency = clamp(Number(concurrency ?? getEnrichConcurrency()), 1, 8);
  const resolvedFetchTimeoutMs = getEnrichFetchTimeoutMs();

  if (!inputItems.length) {
    return {
      items: [],
      warnings: [],
      enrichmentApplied: false,
      enrichedCount: 0,
      enrichmentMode: ENRICHMENT_MODE,
      enrichmentFactCountPerItem: resolvedFactCount,
    };
  }

  const enrichedItems = await runWithConcurrency(
    inputItems,
    resolvedConcurrency,
    (item) =>
      enrichOneHeadline(item, {
        keyword: normalizedKeyword,
        factCount: resolvedFactCount,
        relatedLimit: resolvedRelatedLimit,
        fetchTimeoutMs: resolvedFetchTimeoutMs,
      }),
  );

  let enrichedCount = 0;
  const warnings = [];
  for (let i = 0; i < enrichedItems.length; i += 1) {
    const item = enrichedItems[i];
    if (Array.isArray(item.expandedFacts) && item.expandedFacts.length) {
      enrichedCount += 1;
    }
    if (item.enrichmentWarning) {
      warnings.push(`第${i + 1}条：${item.enrichmentWarning}`);
    }
  }

  return {
    items: enrichedItems,
    warnings,
    enrichmentApplied: enrichedCount > 0,
    enrichedCount,
    enrichmentMode: ENRICHMENT_MODE,
    enrichmentFactCountPerItem: resolvedFactCount,
  };
}

export function buildGammaInputText(items, { keyword } = {}) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const today = new Date().toISOString().slice(0, 10);
  const cards = items.map((item, index) => {
    const expansionLines = [];
    if (Array.isArray(item.expandedFacts) && item.expandedFacts.length) {
      for (let factIndex = 0; factIndex < item.expandedFacts.length; factIndex += 1) {
        const factItem = item.expandedFacts[factIndex];
        expansionLines.push(`*扩展事实${factIndex + 1}*: ${factItem.fact}`);
        const sourceText = (factItem.sources || [])
          .map((source, sourceIndex) => `${sourceIndex + 1}. ${source.title} (${source.url})`)
          .join("；");
        expansionLines.push(`*来源${factIndex + 1}*: ${sourceText}`);
      }
    } else if (item.enrichmentWarning) {
      expansionLines.push("*扩展信息*: 本条扩展失败，已使用原始信息生成。");
    }

    return [
      `## ${index + 1}. ${item.title}`,
      item.date ? `*时间*: ${item.date}` : null,
      `*来源*: ${item.source}`,
      item.link ? `*链接*: ${item.link}` : null,
      ...expansionLines,
      item.imageUrl ? `*配图URL*: ${item.imageUrl}` : "*配图URL*: 无（请改用AI生成）",
      "*配图要求*: 为本条新闻生成一幅说明性AI图片（信息图/新闻插画风格），用于解释新闻重点。",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "请严格使用简体中文输出所有标题与正文，不要使用英文段落。",
    "请优先基于每条新闻给定的扩展事实撰写具体内容，避免泛泛而谈。",
    "不得编造来源链接或未给出的事实。",
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
        `Output all content in Simplified Chinese. Organize the brief around this topic keyword: ${normalizedKeyword}. Prioritize the provided expanded facts and source links for each news card, and avoid generic statements. Do not fabricate facts or sources beyond the provided inputs. Create region/country-focused social cards in a clean news style with a 4:5 layout. Every single news card must include exactly one explanatory image. Use the provided image URL as the real image whenever available; if missing or invalid, generate one relevant AI image using flux-2-pro. Keep each card short and scannable.`,
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
