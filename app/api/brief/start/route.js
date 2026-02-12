import { NextResponse } from "next/server";
import { buildGammaInputText, fetchHeadlines, gammaCreateWebpage, normalizeLimit } from "../_lib/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = normalizeLimit(body.limit);
    const headlines = await fetchHeadlines({ limit });

    if (!headlines.length) {
      return NextResponse.json({ error: "未抓取到可用新闻" }, { status: 502 });
    }

    const inputText = buildGammaInputText(headlines);
    const generationId = await gammaCreateWebpage({ inputText });

    return NextResponse.json({
      generationId,
      headlineCount: headlines.length,
      headlines: headlines.map((item) => ({
        title: item.title,
        link: item.link,
        date: item.date,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "创建任务失败" },
      { status: 500 },
    );
  }
}
