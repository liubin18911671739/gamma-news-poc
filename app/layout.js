import "./globals.css";

export const metadata = {
  title: "Global Insight & AI Decision Lab",
  description: "关键词驱动、多 RSS 聚合的 新闻简报生成器",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
