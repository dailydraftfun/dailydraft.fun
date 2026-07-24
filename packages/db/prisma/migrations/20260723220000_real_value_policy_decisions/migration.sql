CREATE TABLE "RealValuePolicyDecision" (
    "id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "runtimeMode" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "denialReason" TEXT,
    "evidence" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealValuePolicyDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RealValuePolicyDecision_capability_evaluatedAt_idx"
ON "RealValuePolicyDecision"("capability", "evaluatedAt");

CREATE INDEX "RealValuePolicyDecision_allowed_evaluatedAt_idx"
ON "RealValuePolicyDecision"("allowed", "evaluatedAt");

CREATE INDEX "RealValuePolicyDecision_policyVersion_evaluatedAt_idx"
ON "RealValuePolicyDecision"("policyVersion", "evaluatedAt");

ALTER TABLE "RealValuePolicyDecision"
ADD CONSTRAINT "RealValuePolicyDecision_contract_check" CHECK (
  "runtimeMode" IN ('fixture', 'devnet', 'production', 'unclassified')
  AND "schemaVersion" = 'openpacksduel.real-value-policy.v1'
  AND char_length("policyVersion") BETWEEN 3 AND 128
  AND "policyHash" ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof("evidence") = 'object'
  AND (
    ("allowed" AND "denialReason" IS NULL)
    OR (NOT "allowed" AND "denialReason" IS NOT NULL)
  )
);

CREATE FUNCTION "reject_real_value_policy_decision_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RealValuePolicyDecision is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RealValuePolicyDecision_append_only"
BEFORE UPDATE OR DELETE ON "RealValuePolicyDecision"
FOR EACH ROW EXECUTE FUNCTION "reject_real_value_policy_decision_mutation"();

CREATE TRIGGER "RealValuePolicyDecision_append_only_truncate"
BEFORE TRUNCATE ON "RealValuePolicyDecision"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_real_value_policy_decision_mutation"();
