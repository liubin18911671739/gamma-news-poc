import { NextResponse } from "next/server";
import {
  buildGammaInputText,
  fetchHeadlines,
  gammaCreateWebpage,
  normalizeKeyword,
  normalizeLimit,
  normalizeRssUrls,
} from "../_lib/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = normalizeLimit(body.limit);
    const keyword = normalizeKeyword(body.keyword);
    const rssInput = normalizeRssUrls(body.rssUrls);
    const fetchResult = await fetchHeadlines({
      limit,
      keyword,
      rssUrls: rssInput.urls,
    });
    const { headlines } = fetchResult;
    const warnings = [...fetchResult.warnings];

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
            rssUrls: rssInput.urls,
            effectiveSources: fetchResult.effectiveSources,
          },
        },
        { status: 502 },
      );
    }

    const inputText = buildGammaInputText(headlines, { keyword });
    const generationId = await gammaCreateWebpage({ inputText, keyword });

    return NextResponse.json({
      generationId,
      headlineCount: headlines.length,
      headlines: headlines.map((item) => ({
        title: item.title,
        link: item.link,
        date: item.date,
      })),
      requestConfig: {
        limit,
        keyword,
        rssUrls: fetchResult.rssUrls,
        effectiveSources: fetchResult.effectiveSources,
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
