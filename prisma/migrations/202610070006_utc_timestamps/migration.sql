-- Persist actual UTC instants, avoiding session-timezone-dependent expiry.
-- Prior deployments must have used UTC for naive timestamps.
ALTER TABLE "StaffUser" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "StaffSession" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE 'UTC';
ALTER TABLE "StaffSession" ALTER COLUMN "authenticatedAt" TYPE TIMESTAMPTZ(3) USING "authenticatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "AuthThrottle" ALTER COLUMN "windowStart" TYPE TIMESTAMPTZ(3) USING "windowStart" AT TIME ZONE 'UTC';
ALTER TABLE "Member" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "ImportJob" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "RegistrationSubmission" ALTER COLUMN "ingestedAt" TYPE TIMESTAMPTZ(3) USING "ingestedAt" AT TIME ZONE 'UTC';
ALTER TABLE "SubmissionDecision" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Announcement" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Tournament" ALTER COLUMN "startsAt" TYPE TIMESTAMPTZ(3) USING "startsAt" AT TIME ZONE 'UTC';
ALTER TABLE "Tournament" ALTER COLUMN "registrationDeadline" TYPE TIMESTAMPTZ(3) USING "registrationDeadline" AT TIME ZONE 'UTC';
ALTER TABLE "Tournament" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Match" ALTER COLUMN "scheduledAt" TYPE TIMESTAMPTZ(3) USING "scheduledAt" AT TIME ZONE 'UTC';
ALTER TABLE "ResultVersion" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "ResultVersion" ALTER COLUMN "acceptedAt" TYPE TIMESTAMPTZ(3) USING "acceptedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Evidence" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Dispute" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "RankingSnapshot" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "AuditEvent" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
