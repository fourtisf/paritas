/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/shared ships TypeScript source and imports ../../config/*.json and ../../deployments/*.json
  transpilePackages: ["@paritas/shared"],
  experimental: { externalDir: true },
  // the prototype is a hash router (#/trade). Production uses real routes; keep old links working:
  async redirects() {
    return [{ source: "/platform", destination: "/app/trade", permanent: false }];
  },
};
export default nextConfig;
