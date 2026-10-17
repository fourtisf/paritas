// PM2 on the Hostinger VPS:  pm2 start apps/api/ecosystem.config.cjs && pm2 save
// Env comes from apps/api/.env (copy .env.example). Run `npm run db:migrate -w @paritas/api` before first start.
module.exports = {
  apps: [
    { name: "paritas-api", cwd: __dirname, script: "src/server.ts", interpreter: "node", node_args: "--import tsx", env_file: ".env", max_memory_restart: "512M" },
    { name: "paritas-indexer", cwd: __dirname, script: "src/indexer.ts", interpreter: "node", node_args: "--import tsx", env_file: ".env", max_memory_restart: "512M" },
  ],
};
