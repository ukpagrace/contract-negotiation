-- AlterTable
ALTER TABLE "ContractParty" ADD COLUMN     "signedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SigningRequest" ADD COLUMN     "auditFileKey" TEXT,
ADD COLUMN     "counterpartySubmitterId" TEXT,
ADD COLUMN     "proposerSubmitterId" TEXT,
ADD COLUMN     "signedFileKey" TEXT;
