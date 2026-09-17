/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The local SDK ships untranspiled JSX source; let Next compile it.
  transpilePackages: ['@veneer/react', '@veneer/core'],
};

module.exports = nextConfig;
