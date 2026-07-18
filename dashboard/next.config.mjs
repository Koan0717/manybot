/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://discord.com https://*.discord.com;",
          }
        ],
      },
    ];
  },
};

export default nextConfig;
