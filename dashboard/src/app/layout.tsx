import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evalia Dashboard",
  description: "Dashboard for Discord Bot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
