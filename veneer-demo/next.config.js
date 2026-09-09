/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The local SDK ships untranspiled JSX source; let Next compile it.
  transpilePackages: ['veneer-sdk'],
};

module.exports = nextConfig;
