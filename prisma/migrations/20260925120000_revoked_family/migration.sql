-- CreateTable
CREATE TABLE "RevokedFamily" (
    "family" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevokedFamily_pkey" PRIMARY KEY ("family")
);
