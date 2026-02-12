import { NextResponse } from "next/server";
import { fetchGammaOgImage, gammaGetGeneration } from "../_lib/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const generationId = searchParams.get("generationId");

    if (!generationId) {
      return NextResponse.json({ error: "缺少 generationId" }, { status: 400 });
    }

    const result = await gammaGetGeneration(generationId);
    const heroImageUrl = result.status === "completed" ? await fetchGammaOgImage(result.gammaUrl) : null;

    return NextResponse.json({
      ...result,
      generationId,
      heroImageUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "查询状态失败" },
      { status: 500 },
    );
  }
}
