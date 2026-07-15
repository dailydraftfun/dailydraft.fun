CREATE TYPE "OperatorAction" AS ENUM ('EMERGENCY_PAUSE', 'EMERGENCY_RESUME');
CREATE TYPE "OperatorActorClass" AS ENUM ('INTEGRATION_KEY');
CREATE TYPE "OperatorReasonCode" AS ENUM ('MAINTENANCE', 'PROVIDER_DEGRADED', 'RPC_DEGRADED', 'TREASURY_LIMIT', 'SECURITY_INCIDENT', 'MANUAL_REVIEW');

CREATE TABLE "RuntimeControl" (
    "key" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "reasonCode" "OperatorReasonCode",
    "actorClass" "OperatorActorClass" NOT NULL DEFAULT 'INTEGRATION_KEY',
    "actorLabel" TEXT NOT NULL DEFAULT 'integration-key',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeControl_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "OperatorAuditEvent" (
    "id" TEXT NOT NULL,
    "action" "OperatorAction" NOT NULL,
    "actorClass" "OperatorActorClass" NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "reasonCode" "OperatorReasonCode" NOT NULL,
    "previousPaused" BOOLEAN NOT NULL,
    "nextPaused" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperatorAuditEvent_createdAt_id_idx" ON "OperatorAuditEvent"("createdAt", "id");

INSERT INTO "RuntimeControl" ("key", "paused", "actorClass", "actorLabel", "version", "updatedAt")
VALUES ('global_exposure', false, 'INTEGRATION_KEY', 'integration-key', 1, CURRENT_TIMESTAMP);

CREATE FUNCTION "reject_operator_audit_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'OperatorAuditEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperatorAuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "OperatorAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_operator_audit_mutation"();
