"use client";

import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 2500;
const DEFAULT_KEYWORD = "artificial intelligence geopolitics regional policy";

const STATUS_LABELS = {
  idle: "待开始",
  starting: "初始化任务",
  processing: "Gamma 生成中",
  completed: "已完成",
  failed: "失败",
};

export default function Page() {
  const [limit, setLimit] = useState(12);
  const [keyword, setKeyword] = useState(DEFAULT_KEYWORD);
  const [rssInput, setRssInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [generationId, setGenerationId] = useState("");
  const [headlines, setHeadlines] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [requestConfig, setRequestConfig] = useState(null);
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
    setWarnings([]);
    setRequestConfig(null);
    setStatus("starting");
    setProgress(0);
    setGenerationId("");

    try {
      const rssUrls = rssInput
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);

      const startRes = await fetch("/api/brief/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          limit: Number(limit),
          keyword,
          rssUrls,
        }),
      });

      const startPayload = await startRes.json();
      setWarnings(startPayload.warnings || []);
      setRequestConfig(startPayload.requestConfig || null);

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
  const statusText = STATUS_LABELS[status] || status;
  const todayLabel = new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date());

  return (
    <main className="page newsroom">
      <section className="masthead card">
        <div className="masthead-body">
          <p className="eyebrow">GAMMA BRIEF WORKDESK</p>
          <h1 className="title">AI 新闻简报工作台</h1>
          <p className="sub">聚合多 RSS 源并根据主题关键词自动生成可分享的新闻简报页面。</p>
          <div className="meta-row">
            <span className="chip">{todayLabel}</span>
            <span className="chip chip-topic">主题：{keyword || DEFAULT_KEYWORD}</span>
          </div>
        </div>
      </section>

      <section className="card composer">
        <div className="section-head">
          <h2>生成配置</h2>
          <p>关键词会同时影响 RSS 抓取范围与 Gamma 内容生成策略。</p>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>主题关键词</span>
            <input
              className="input"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={DEFAULT_KEYWORD}
              disabled={isRunning}
            />
          </label>

          <label className="field">
            <span>抓取条数</span>
            <input
              className="input input-small"
              type="number"
              min={1}
              max={20}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              disabled={isRunning}
            />
          </label>
        </div>

        <label className="field">
          <span>额外 RSS 源（每行一个 URL）</span>
          <textarea
            className="input textarea"
            value={rssInput}
            onChange={(e) => setRssInput(e.target.value)}
            placeholder={"https://example.com/feed.xml\nhttps://another-site.com/rss"}
            disabled={isRunning}
            rows={4}
          />
        </label>

        <div className="action-row">
          <button className="button" type="button" onClick={onGenerate} disabled={loading || isRunning}>
            {isRunning ? "生成中..." : "开始生成简报"}
          </button>
          <p className="hint">生成中会自动轮询状态，完成后可直接打开 Gamma 页面或下载 PDF。</p>
        </div>
      </section>

      {(isRunning || result || error || warnings.length > 0 || requestConfig) && (
        <section className="card status-panel">
          <div className="section-head compact">
            <h2>任务状态</h2>
          </div>

          <div className="status-grid">
            <div className="status-item">
              <span className="key">阶段</span>
              <span className="value">{statusText}</span>
            </div>
            {generationId ? (
              <div className="status-item">
                <span className="key">generationId</span>
                <span className="value mono">{generationId}</span>
              </div>
            ) : null}
            {requestConfig?.keyword ? (
              <div className="status-item">
                <span className="key">原关键词</span>
                <span className="value">{requestConfig.keyword}</span>
              </div>
            ) : null}
            {requestConfig?.searchKeyword ? (
              <div className="status-item">
                <span className="key">搜索关键词</span>
                <span className="value">{requestConfig.searchKeyword}</span>
              </div>
            ) : null}
            {requestConfig?.translatedKeyword ? (
              <div className="status-item">
                <span className="key">翻译关键词</span>
                <span className="value">{requestConfig.translatedKeyword}</span>
              </div>
            ) : null}
            {typeof requestConfig?.translationApplied === "boolean" ? (
              <div className="status-item">
                <span className="key">翻译生效</span>
                <span className="value">{requestConfig.translationApplied ? "是" : "否"}</span>
              </div>
            ) : null}
            {requestConfig?.effectiveSources?.length ? (
              <div className="status-item">
                <span className="key">生效 RSS 源</span>
                <span className="value">{requestConfig.effectiveSources.length} 个</span>
              </div>
            ) : null}
          </div>

          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${Math.max(1, progress)}%` }} />
          </div>

          {warnings.length > 0 ? (
            <div className="warning-list">
              {warnings.map((item) => (
                <p key={item} className="warning-item">{item}</p>
              ))}
            </div>
          ) : null}

          {error ? <div className="error">{error}</div> : null}
        </section>
      )}

      {headlines.length > 0 ? (
        <section className="card panel">
          <details open>
            <summary>本次抓取新闻（{headlines.length} 条）</summary>
            <ol className="headline-list">
              {headlines.map((item) => (
                <li key={`${item.link}-${item.title}`}>
                  <span className="headline-title">{item.title}</span>
                  {item.date ? <span className="headline-date">{item.date}</span> : null}
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : null}

      {result?.status === "completed" && result.gammaUrl ? (
        <section className="card panel result-panel">
          <div className="preview">
            <img src={heroImageUrl} alt="简报封面图" />
          </div>
          <div className="result-content">
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
            <p className="hint">PDF 链接通常有时效性，建议在生成完成后尽快下载。</p>
          </div>
        </section>
      ) : null}
    </main>
  );
}
