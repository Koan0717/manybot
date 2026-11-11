import type { Config } from "tailwindcss";

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
        // どう森BOTダッシュボード（/doumori）用
        leaf: {
          50: "#f2faf3",
          100: "#dff3e2",
          200: "#b8e5c0",
          300: "#8ad196",
          400: "#5cb76c",
          500: "#3a9c4c",
          600: "#2b7d3b",
          700: "#256432",
          800: "#20502c",
          900: "#1b4225",
        },
      },
    },
  },
  plugins: [],
};
export default config;
