import "./globals.css";

export const metadata = {
  title: "Gamma Brief Workdesk",
  description: "关键词驱动、多 RSS 聚合的 Gamma 新闻简报生成器",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
