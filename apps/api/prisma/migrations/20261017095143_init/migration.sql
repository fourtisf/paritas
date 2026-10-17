-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "routeId" DECIMAL(78,0) NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "trader" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "stock" TEXT NOT NULL,
    "buy" BOOLEAN NOT NULL,
    "amountIn" DECIMAL(78,0) NOT NULL,
    "amountOut" DECIMAL(78,0) NOT NULL,
    "protocolFee" DECIMAL(78,0) NOT NULL,
    "oraclePriceWad" DECIMAL(78,0) NOT NULL,
    "session" TEXT NOT NULL,
    "notionalUsd" DOUBLE PRECISION NOT NULL,
    "costBps" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fill" (
    "id" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "legIndex" INTEGER NOT NULL,
    "venue" TEXT NOT NULL,
    "amountIn" DECIMAL(78,0) NOT NULL,
    "amountOut" DECIMAL(78,0) NOT NULL,
    "priceWad" DECIMAL(78,0) NOT NULL,
    "costBps" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Fill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "vault" TEXT NOT NULL,
    "stock" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "reserveStock" DECIMAL(78,0) NOT NULL,
    "reserveUsd" DECIMAL(78,0) NOT NULL,

    CONSTRAINT "VaultSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultFlow" (
    "id" TEXT NOT NULL,
    "vault" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "receiver" TEXT NOT NULL,
    "shares" DECIMAL(78,0) NOT NULL,
    "usdAmount" DECIMAL(78,0) NOT NULL,
    "stockAmount" DECIMAL(78,0) NOT NULL,
    "valueWad" DECIMAL(78,0),
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candle" (
    "stock" TEXT NOT NULL,
    "tf" TEXT NOT NULL,
    "t" TIMESTAMP(3) NOT NULL,
    "o" DECIMAL(78,0) NOT NULL,
    "h" DECIMAL(78,0) NOT NULL,
    "l" DECIMAL(78,0) NOT NULL,
    "c" DECIMAL(78,0) NOT NULL,

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("stock","tf","t")
);

-- CreateTable
CREATE TABLE "GovernanceOp" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "txHash" TEXT NOT NULL,

    CONSTRAINT "GovernanceOp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "name" TEXT NOT NULL,
    "block" BIGINT NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "Route_trader_timestamp_idx" ON "Route"("trader", "timestamp");

-- CreateIndex
CREATE INDEX "Route_stock_timestamp_idx" ON "Route"("stock", "timestamp");

-- CreateIndex
CREATE INDEX "Route_timestamp_idx" ON "Route"("timestamp");

-- CreateIndex
CREATE INDEX "Fill_routeKey_idx" ON "Fill"("routeKey");

-- CreateIndex
CREATE INDEX "VaultSnapshot_vault_timestamp_idx" ON "VaultSnapshot"("vault", "timestamp");

-- CreateIndex
CREATE INDEX "VaultFlow_owner_timestamp_idx" ON "VaultFlow"("owner", "timestamp");

-- CreateIndex
CREATE INDEX "VaultFlow_vault_timestamp_idx" ON "VaultFlow"("vault", "timestamp");

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_routeKey_fkey" FOREIGN KEY ("routeKey") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
