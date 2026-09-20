import type { Metadata } from "next";
import "./globals.css";
import TokenProvider from "./TokenProvider";

import { Toaster } from 'react-hot-toast';
import { ACTIVITY_STASH_SCRIPT } from "@/lib/activityStash";

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
      <head>
        {/* どのページが最初に開かれても、Discordアクティビティの起動パラメータ(frame_id等)を退避する */}
        <script dangerouslySetInnerHTML={{ __html: ACTIVITY_STASH_SCRIPT }} />
      </head>
      <body>
        <TokenProvider>
          {children}
        </TokenProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
