import "./globals.css";

export const metadata = {
  title: "Gamma Daily Brief",
  description: "基于 RSS 与 Gamma API 的新闻简报生成器",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
