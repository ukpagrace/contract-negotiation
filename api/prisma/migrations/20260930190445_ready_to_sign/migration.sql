-- CreateEnum
CREATE TYPE "SignaturePlacement" AS ENUM ('SPOTS', 'PAGE');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "signaturePlacement" "SignaturePlacement";

-- AlterTable
ALTER TABLE "ContractParty" ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "readyByUserId" TEXT,
ADD COLUMN     "signerUserId" TEXT;

-- AddForeignKey
ALTER TABLE "ContractParty" ADD CONSTRAINT "ContractParty_readyByUserId_fkey" FOREIGN KEY ("readyByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractParty" ADD CONSTRAINT "ContractParty_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Default signers for existing contracts: the creator for the proposer, the onboarding contact
-- (the counterparty invite sent by the creator) for the counterparty, if they have an account.
UPDATE "ContractParty" p SET "signerUserId" = c."createdById"
FROM "Contract" c WHERE c."id" = p."contractId" AND p."role" = 'PROPOSER';

UPDATE "ContractParty" p SET "signerUserId" = u."id"
FROM "Contract" c, "Invite" i, "User" u
WHERE c."id" = p."contractId" AND p."role" = 'COUNTERPARTY'
  AND i."partyId" = p."id" AND i."invitedById" = c."createdById" AND u."email" = i."email";
