import type { Metadata } from "next";
import "./globals.css";
import TokenProvider from "./TokenProvider";

export const metadata: Metadata = {
  title: "Many Dashboard",
  description: "Web Dashboard for Many BOT",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <TokenProvider>
          {children}
        </TokenProvider>
      </body>
    </html>
  );
}
