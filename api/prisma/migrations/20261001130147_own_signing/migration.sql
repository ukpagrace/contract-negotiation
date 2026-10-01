/*
  Warnings:

  - You are about to drop the column `auditFileKey` on the `SigningRequest` table. All the data in the column will be lost.
  - You are about to drop the column `counterpartySubmitterId` on the `SigningRequest` table. All the data in the column will be lost.
  - You are about to drop the column `proposerSubmitterId` on the `SigningRequest` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SigningRequest" DROP COLUMN "auditFileKey",
DROP COLUMN "counterpartySubmitterId",
DROP COLUMN "proposerSubmitterId",
ADD COLUMN     "unsignedFileKey" TEXT,
ADD COLUMN     "unsignedHash" TEXT;

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "documentHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Signature_requestId_partyId_key" ON "Signature"("requestId", "partyId");

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SigningRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "ContractParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
