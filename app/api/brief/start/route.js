import { NextResponse } from "next/server";
import {
  buildGammaInputText,
  enrichHeadlines,
  expandHeadlinesByCoreSearch,
  fetchHeadlines,
  gammaCreateWebpage,
  normalizeKeyword,
  normalizeLimit,
  normalizeRssUrls,
  translateKeywordForSearch,
} from "../_lib/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = normalizeLimit(body.limit);
    const keyword = normalizeKeyword(body.keyword);
    const translation = await translateKeywordForSearch(keyword);
    const searchKeyword = translation.searchKeyword;
    const rssInput = normalizeRssUrls(body.rssUrls);
    const fetchResult = await fetchHeadlines({
      limit,
      keyword: searchKeyword,
      rssUrls: rssInput.urls,
    });
    let { headlines } = fetchResult;
    const warnings = [...fetchResult.warnings];

    if (translation.warning) {
      warnings.unshift(translation.warning);
    }

    if (rssInput.invalid.length) {
      warnings.push(`以下 RSS 地址格式错误，已忽略：${rssInput.invalid.join("，")}`);
    }

    if (!headlines.length) {
      return NextResponse.json(
        {
          error: "未抓取到可用新闻，请检查关键词或 RSS 源后重试",
          warnings,
          requestConfig: {
            limit,
            keyword,
            translatedKeyword: translation.translatedKeyword,
            searchKeyword: translation.searchKeyword,
            translationApplied: translation.translationApplied,
            rssUrls: rssInput.urls,
            effectiveSources: fetchResult.effectiveSources,
            enrichmentApplied: false,
            enrichedCount: 0,
            enrichmentMode: "article_plus_related_rss",
            enrichmentFactCountPerItem: 2,
            coreSearchApplied: false,
            coreSearchPerItemLimit: 3,
            coreSearchAddedCount: 0,
            newsPoolSize: 0,
            newsPoolMaxItems: 60,
          },
        },
        { status: 502 },
      );
    }

    const enrichment = await enrichHeadlines(headlines, {
      keyword: searchKeyword,
      factCount: 2,
      relatedLimit: 3,
      concurrency: 3,
    });
    headlines = enrichment.items;
    warnings.push(...enrichment.warnings);

    const expansion = await expandHeadlinesByCoreSearch(headlines, {
      keyword: searchKeyword,
    });
    headlines = expansion.items;
    warnings.push(...expansion.warnings);

    const inputText = buildGammaInputText(headlines, { keyword });
    const generationId = await gammaCreateWebpage({ inputText, keyword });

    return NextResponse.json({
      generationId,
      headlineCount: headlines.length,
      headlines: headlines.map((item) => ({
        title: item.title,
        link: item.link,
        source: item.source,
        date: item.date,
        articleSnippet: item.articleSnippet || null,
        expandedFacts: item.expandedFacts || [],
        enrichmentWarning: item.enrichmentWarning || null,
      })),
      requestConfig: {
        limit,
        keyword,
        translatedKeyword: translation.translatedKeyword,
        searchKeyword: translation.searchKeyword,
        translationApplied: translation.translationApplied,
        rssUrls: fetchResult.rssUrls,
        effectiveSources: fetchResult.effectiveSources,
        enrichmentApplied: enrichment.enrichmentApplied,
        enrichedCount: enrichment.enrichedCount,
        enrichmentMode: enrichment.enrichmentMode,
        enrichmentFactCountPerItem: enrichment.enrichmentFactCountPerItem,
        coreSearchApplied: expansion.coreSearchApplied,
        coreSearchPerItemLimit: expansion.coreSearchPerItemLimit,
        coreSearchAddedCount: expansion.coreSearchAddedCount,
        newsPoolSize: expansion.newsPoolSize,
        newsPoolMaxItems: expansion.newsPoolMaxItems,
      },
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "创建任务失败" },
      { status: 500 },
    );
  }
}
