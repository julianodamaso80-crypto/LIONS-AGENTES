/** @type {import('next').NextConfig} */
const { withSentryConfig } = require("@sentry/nextjs");

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
};

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  org: "scale-v2-lionlabs",
  project: "javascript-nextjs",
});