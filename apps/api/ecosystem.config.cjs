// PM2 on the Hostinger VPS:  pm2 start apps/api/ecosystem.config.cjs && pm2 save
// PM2 does not read .env files, so Node loads apps/api/.env itself (--env-file, Node >= 20.6).
// Copy .env.mainnet.example to .env and run `npm run db:migrate -w @paritas/api` before the first start.
module.exports = {
  apps: [
    { name: "paritas-api", cwd: __dirname, script: "src/server.ts", interpreter: "node", node_args: "--env-file=.env --import tsx", max_memory_restart: "512M" },
    { name: "paritas-indexer", cwd: __dirname, script: "src/indexer.ts", interpreter: "node", node_args: "--env-file=.env --import tsx", max_memory_restart: "512M" },
  ],
};
