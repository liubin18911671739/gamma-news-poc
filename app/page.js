"use client";

import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 2500;

export default function Page() {
  const [limit, setLimit] = useState(12);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [generationId, setGenerationId] = useState("");
  const [headlines, setHeadlines] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const pollTimerRef = useRef(null);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const pollStatus = async (id) => {
    const res = await fetch(`/api/brief/status?generationId=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "轮询任务状态失败");
    }

    setStatus(payload.status || "processing");
    setProgress(typeof payload.progress === "number" ? payload.progress : 0);
    setResult(payload);

    if (payload.status === "completed" || payload.status === "failed") {
      stopPolling();
      if (payload.status === "failed") {
        setError(payload.error || "生成失败，请稍后重试");
      }
    }
  };

  const onGenerate = async () => {
    stopPolling();
    setLoading(true);
    setError("");
    setResult(null);
    setHeadlines([]);
    setStatus("starting");
    setProgress(0);

    try {
      const startRes = await fetch("/api/brief/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: Number(limit) }),
      });

      const startPayload = await startRes.json();
      if (!startRes.ok) {
        throw new Error(startPayload.error || "创建生成任务失败");
      }

      setGenerationId(startPayload.generationId);
      setHeadlines(startPayload.headlines || []);
      setStatus("processing");
      setProgress(1);

      await pollStatus(startPayload.generationId);
      pollTimerRef.current = setInterval(() => {
        pollStatus(startPayload.generationId).catch((e) => {
          stopPolling();
          setStatus("failed");
          setError(e.message || "轮询任务失败");
        });
      }, POLL_INTERVAL_MS);
    } catch (e) {
      setStatus("failed");
      setError(e.message || "请求失败");
    } finally {
      setLoading(false);
    }
  };

  const heroImageUrl = result?.heroImageUrl || "/hero.png";
  const isRunning = status === "starting" || status === "processing";

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-header">
          <h1 className="title">AI 区域国别新闻简报</h1>
          <p className="sub">
            使用 Google News RSS 抓取头条，再通过 Gamma API 自动生成可分享的新闻简报页面。
          </p>
        </div>
        <div className="controls">
          <div className="row">
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
            <button className="button" type="button" onClick={onGenerate} disabled={loading || isRunning}>
              {isRunning ? "生成中..." : "开始生成"}
            </button>
          </div>

          {(isRunning || result) && (
            <div className="status">
              <div>任务状态：{status}</div>
              {generationId ? <div>generationId：{generationId}</div> : null}
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${Math.max(1, progress)}%` }} />
              </div>
            </div>
          )}

          {error ? <div className="error">{error}</div> : null}
        </div>
      </section>

      {headlines.length > 0 ? (
        <section className="panel">
          <div className="content">
            <h3>本次抓取到的新闻标题（前 {headlines.length} 条）</h3>
            <ol className="headline-list">
              {headlines.map((item) => (
                <li key={`${item.link}-${item.title}`}>{item.title}</li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      {result?.status === "completed" && result.gammaUrl ? (
        <section className="panel">
          <div className="preview">
            <img src={heroImageUrl} alt="简报封面图" />
          </div>
          <div className="content">
            <h3>简报已生成</h3>
            <div className="links">
              <a className="link-btn link-primary" href={result.gammaUrl} target="_blank" rel="noreferrer">
                浏览新闻列表
              </a>
              {result.pdfUrl ? (
                <a className="link-btn link-secondary" href={result.pdfUrl} target="_blank" rel="noreferrer">
                  导出 PDF
                </a>
              ) : null}
            </div>
            <p className="hint">PDF 链接通常有时效性，建议生成后尽快下载。</p>
          </div>
        </section>
      ) : null}
    </main>
  );
}
