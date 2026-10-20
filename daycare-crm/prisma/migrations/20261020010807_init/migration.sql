-- CreateTable
CREATE TABLE "Center" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'center',
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "ein" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "lockDate" DATETIME,
    "invoiceDueDays" INTEGER NOT NULL DEFAULT 7,
    "lateFeeCents" INTEGER NOT NULL DEFAULT 0,
    "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 5,
    "cardFeeBps" INTEGER NOT NULL DEFAULT 290,
    "cardFeeFixedCents" INTEGER NOT NULL DEFAULT 30,
    "achFeeBps" INTEGER NOT NULL DEFAULT 80,
    "achFeeCapCents" INTEGER NOT NULL DEFAULT 500,
    "siblingDiscountBps" INTEGER NOT NULL DEFAULT 0,
    "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1001,
    "nextJournalNumber" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "classroomId" TEXT,
    "guardianId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Classroom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ageGroup" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "ratio" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Guardian" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "relationship" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "canPickup" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Guardian_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Child" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATETIME NOT NULL,
    "classroomId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENROLLED',
    "allergies" TEXT,
    "medicalNotes" TEXT,
    "immunizationsDue" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Child_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Child_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "childId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "day" DATETIME NOT NULL,
    "checkInAt" DATETIME NOT NULL,
    "checkOutAt" DATETIME,
    "checkInBy" TEXT,
    "checkOutBy" TEXT,
    "pickedUpBy" TEXT,
    CONSTRAINT "Attendance_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StaffShift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "clockInAt" DATETIME NOT NULL,
    "clockOutAt" DATETIME,
    CONSTRAINT "StaffShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StaffShift_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "childName" TEXT NOT NULL,
    "childDob" DATETIME,
    "desiredStart" DATETIME,
    "classroomId" TEXT,
    "source" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'INQUIRY',
    "tourAt" DATETIME,
    "lostReason" TEXT,
    "notes" TEXT,
    "familyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "systemKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "memo" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "reversesId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JournalEntry_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "JournalEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "payerId" TEXT,
    "classroomId" TEXT,
    "memo" TEXT,
    CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JournalLine_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JournalLine_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT,
    "familyId" TEXT,
    "guardianId" TEXT,
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "paymentMethodLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payer_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payer_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeePlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL,
    "revenueAccountId" TEXT NOT NULL,
    "classroomId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeePlan_revenueAccountId_fkey" FOREIGN KEY ("revenueAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeePlan_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "childId" TEXT NOT NULL,
    "feePlanId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Enrollment_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Enrollment_feePlanId_fkey" FOREIGN KEY ("feePlanId") REFERENCES "FeePlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enrollmentId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    CONSTRAINT "BillingSplit_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingSplit_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "invoiceCount" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "payerId" TEXT NOT NULL,
    "issueDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "totalCents" INTEGER NOT NULL,
    "memo" TEXT,
    "billingRunId" TEXT,
    "journalEntryId" TEXT,
    "lateFeeForId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_billingRunId_fkey" FOREIGN KEY ("billingRunId") REFERENCES "BillingRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "childId" TEXT,
    "enrollmentId" TEXT,
    "classroomId" TEXT,
    "dedupeKey" TEXT,
    CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvoiceLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceLine_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InvoiceLine_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payerId" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "method" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "memo" TEXT,
    "depositId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Adjustment_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Adjustment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT,
    "adjustmentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Allocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Allocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Allocation_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "Adjustment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT,
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Deposit_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "tenantId" TEXT,
    "companyName" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "expiresAt" DATETIME,
    "syncMode" TEXT NOT NULL DEFAULT 'SUMMARY',
    "syncFrom" DATETIME,
    "connectedAt" DATETIME,
    "lastSyncAt" DATETIME,
    "lastError" TEXT
);

-- CreateTable
CREATE TABLE "ExternalRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "remoteName" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "localId" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_guardianId_key" ON "User"("guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "Classroom_name_key" ON "Classroom"("name");

-- CreateIndex
CREATE INDEX "Attendance_classroomId_day_idx" ON "Attendance"("classroomId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_childId_day_key" ON "Attendance"("childId", "day");

-- CreateIndex
CREATE INDEX "StaffShift_classroomId_clockOutAt_idx" ON "StaffShift"("classroomId", "clockOutAt");

-- CreateIndex
CREATE INDEX "Message_familyId_createdAt_idx" ON "Message"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_stage_idx" ON "Lead"("stage");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_systemKey_key" ON "Account"("systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_number_key" ON "JournalEntry"("number");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversesId_key" ON "JournalEntry"("reversesId");

-- CreateIndex
CREATE INDEX "JournalEntry_date_idx" ON "JournalEntry"("date");

-- CreateIndex
CREATE INDEX "JournalEntry_source_sourceId_idx" ON "JournalEntry"("source", "sourceId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "JournalLine_payerId_idx" ON "JournalLine"("payerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payer_guardianId_key" ON "Payer"("guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSplit_enrollmentId_payerId_key" ON "BillingSplit"("enrollmentId", "payerId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_journalEntryId_key" ON "Invoice"("journalEntryId");

-- CreateIndex
CREATE INDEX "Invoice_payerId_status_idx" ON "Invoice"("payerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_dedupeKey_key" ON "InvoiceLine"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_journalEntryId_key" ON "Payment"("journalEntryId");

-- CreateIndex
CREATE INDEX "Payment_payerId_idx" ON "Payment"("payerId");

-- CreateIndex
CREATE INDEX "Payment_depositId_idx" ON "Payment"("depositId");

-- CreateIndex
CREATE UNIQUE INDEX "Adjustment_journalEntryId_key" ON "Adjustment"("journalEntryId");

-- CreateIndex
CREATE INDEX "Allocation_invoiceId_idx" ON "Allocation"("invoiceId");

-- CreateIndex
CREATE INDEX "Allocation_paymentId_idx" ON "Allocation"("paymentId");

-- CreateIndex
CREATE INDEX "Allocation_adjustmentId_idx" ON "Allocation"("adjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_journalEntryId_key" ON "Refund"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_journalEntryId_key" ON "Deposit"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_provider_key" ON "Integration"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRef_provider_entityType_localId_key" ON "ExternalRef"("provider", "entityType", "localId");

-- CreateIndex
CREATE INDEX "SyncLog_provider_createdAt_idx" ON "SyncLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
