-- PostgreSQL requires a newly-added enum value to commit before a later
-- transaction may reference it in a CHECK constraint.
ALTER TYPE "GachaRipPaymentStatus" ADD VALUE 'FAILED';
