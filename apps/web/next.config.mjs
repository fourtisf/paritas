/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // lets a second dev server run side by side (NEXT_DIST_DIR=.next-alt next dev -p 3100)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // packages/shared ships TypeScript source and imports ../../config/*.json and ../../deployments/*.json
  transpilePackages: ["@paritas/shared"],
  experimental: { externalDir: true },
  // packages/shared's loadLocalDeployment() (Node only) dynamically imports node:fs/promises. The browser bundle
  // never calls it, so resolve the Node built-ins to nothing there instead of failing the build.
  webpack(config, { isServer, webpack }) {
    // Optional peers of wallet SDKs that are not installed: @x402/* (baseAccount's cdp-sdk, a connector we never use),
    // React Native storage (MetaMask SDK) and pino-pretty (WalletConnect logger). Skip them instead of failing/warning.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^(@x402\/.*|@react-native-async-storage\/async-storage|pino-pretty)$/ }));
    // loadLocalDeployment() points at deployments/31337.json with new URL(..., import.meta.url), which webpack would
    // copy into the bundle (and fail on when the file does not exist, as on a production build server). The web app
    // reads that file on the server instead (lib/deployment.server.ts).
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /deployments\/31337\.json$/ }));
    if (!isServer) {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:/, (r) => { r.request = r.request.replace(/^node:/, ""); }));
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, "fs/promises": false, path: false };
    }
    return config;
  },
  // the prototype is a hash router (#/trade). Production uses real routes; keep old links working:
  async redirects() {
    return [{ source: "/platform", destination: "/app/trade", permanent: false }];
  },
};
export default nextConfig;
