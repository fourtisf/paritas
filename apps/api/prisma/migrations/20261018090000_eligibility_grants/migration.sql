-- CreateTable
CREATE TABLE "EligibilityGrant" (
    "id" SERIAL NOT NULL,
    "chainId" INTEGER NOT NULL,
    "account" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "declarationSig" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EligibilityGrant_account_idx" ON "EligibilityGrant"("account");

