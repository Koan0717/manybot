import os
import json

def create_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Created: {path}")

def init_nextjs():
    base = "dashboard"
    os.makedirs(base, exist_ok=True)

    package_json = {
      "name": "eval-bot-dashboard",
      "version": "0.1.0",
      "private": True,
      "scripts": {
        "dev": "next dev",
        "build": "next build",
        "start": "next start",
        "lint": "next lint"
      },
      "dependencies": {
        "next": "14.2.3",
        "react": "^18",
        "react-dom": "^18",
        "@discord/embedded-app-sdk": "^1.2.0",
        "@supabase/supabase-js": "^2.43.4"
      },
      "devDependencies": {
        "typescript": "^5",
        "@types/node": "^20",
        "@types/react": "^18",
        "@types/react-dom": "^18",
        "postcss": "^8",
        "tailwindcss": "^3.4.1",
        "eslint": "^8",
        "eslint-config-next": "14.2.3"
      }
    }
    
    create_file(f"{base}/package.json", json.dumps(package_json, indent=2))
    
    tsconfig = {
      "compilerOptions": {
        "lib": ["dom", "dom.iterable", "esnext"],
        "allowJs": True,
        "skipLibCheck": True,
        "strict": True,
        "noEmit": True,
        "esModuleInterop": True,
        "module": "esnext",
        "moduleResolution": "bundler",
        "resolveJsonModule": True,
        "isolatedModules": True,
        "jsx": "preserve",
        "incremental": True,
        "plugins": [
          {
            "name": "next"
          }
        ],
        "paths": {
          "@/*": ["./src/*"]
        }
      },
      "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      "exclude": ["node_modules"]
    }
    
    create_file(f"{base}/tsconfig.json", json.dumps(tsconfig, indent=2))
    
    create_file(f"{base}/next.config.mjs", "/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nexport default nextConfig;\n")
    
    tailwind = """import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
};
export default config;
"""
    create_file(f"{base}/tailwind.config.ts", tailwind)
    
    postcss = """module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
"""
    create_file(f"{base}/postcss.config.js", postcss)
    
    globals_css = """@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #121212;
  --foreground: #ffffff;
}

body {
  background-color: var(--background);
  color: var(--foreground);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
"""
    create_file(f"{base}/src/app/globals.css", globals_css)
    
    layout = """import type { Metadata } from "next";
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
"""
    create_file(f"{base}/src/app/layout.tsx", layout)
    
    page = """'use client';

import { useEffect, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';

// Client ID for Discord Activity (To be set)
const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || '1234567890';
let discordSdk: DiscordSDK | null = null;

export default function Home() {
  const [auth, setAuth] = useState<any>(null);

  useEffect(() => {
    // Only init inside discord iframe
    if (typeof window !== 'undefined' && window.parent !== window) {
      discordSdk = new DiscordSDK(clientId);
      discordSdk.ready().then(() => {
        setAuth({ status: 'Ready to Auth' });
      });
    }
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-zinc-900 text-white">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8 text-center text-red-500">Evalia BOT Dashboard</h1>
        
        <div className="bg-zinc-800 p-6 rounded-xl shadow-lg border border-zinc-700">
          <h2 className="text-2xl mb-4 border-b border-zinc-600 pb-2">サーバー設定</h2>
          
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm text-zinc-400">準メンバー（任意）</label>
              <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none">
                <option>未設定</option>
              </select>
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm text-zinc-400">仮メンバー</label>
              <select className="bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none">
                <option>未設定</option>
              </select>
            </div>
            
            <button className="mt-4 w-full bg-red-600 hover:bg-red-700 transition-colors py-2 rounded-lg font-bold">
              保存
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
"""
    create_file(f"{base}/src/app/page.tsx", page)
    
    print("Next.js project initialized successfully!")

if __name__ == "__main__":
    init_nextjs()
