-- Brand rename, second pass: the valuation-policy identifiers.
--
-- CANONICAL_VALUATION_POLICY.schemaVersion and DEVNET_DEMO_VALUATION_POLICY.policyVersion
-- moved from the retired "openpacksduel" prefix to "dailydraft". Both values are
-- hashed into the frozen policy objects, so renaming them moved the two policy
-- hashes as well:
--
--   canonical  406b8f93087ba9910d74006cef30fb7872dcabd763e99215488f06f119b8d66b
--           -> b1334fcec0e89380bc0b32b2210a9ca99fb72d64bfd75e4c2c2d64cbe40b43ba
--   devnet demo 39186a3c3b133d001d3c17dd3832b45c2286e3df81ba13494e3cef638a48baf8
--           -> 0d8f1654c4d5c86622e207622bea835d029ecc78ed2ca1a24ba739a2c356c9fd
--
-- requireCanonicalValuationPolicyHash rejects any hash that is not one of the two
-- current constants, so stored rows have to move forward with the code or every
-- duel that reads its pinned policy starts failing. The preview runs on Solana
-- devnet only, so no settled mainnet evidence pins the retired hashes.
--
-- No CHECK constraint references either hash, so this is a plain data rewrite.
-- Earlier migrations are applied history and are deliberately left untouched:
-- editing them would break their recorded checksums.

UPDATE "Duel"
SET "valuationPolicyHash" = 'b1334fcec0e89380bc0b32b2210a9ca99fb72d64bfd75e4c2c2d64cbe40b43ba'
WHERE "valuationPolicyHash" = '406b8f93087ba9910d74006cef30fb7872dcabd763e99215488f06f119b8d66b';

UPDATE "Duel"
SET "valuationPolicyHash" = '0d8f1654c4d5c86622e207622bea835d029ecc78ed2ca1a24ba739a2c356c9fd'
WHERE "valuationPolicyHash" = '39186a3c3b133d001d3c17dd3832b45c2286e3df81ba13494e3cef638a48baf8';

UPDATE "MatchmakingTicket"
SET "valuationPolicyHash" = 'b1334fcec0e89380bc0b32b2210a9ca99fb72d64bfd75e4c2c2d64cbe40b43ba'
WHERE "valuationPolicyHash" = '406b8f93087ba9910d74006cef30fb7872dcabd763e99215488f06f119b8d66b';

UPDATE "MatchmakingTicket"
SET "valuationPolicyHash" = '0d8f1654c4d5c86622e207622bea835d029ecc78ed2ca1a24ba739a2c356c9fd'
WHERE "valuationPolicyHash" = '39186a3c3b133d001d3c17dd3832b45c2286e3df81ba13494e3cef638a48baf8';

UPDATE "DuelPackOutcome"
SET "valuationPolicyHash" = 'b1334fcec0e89380bc0b32b2210a9ca99fb72d64bfd75e4c2c2d64cbe40b43ba'
WHERE "valuationPolicyHash" = '406b8f93087ba9910d74006cef30fb7872dcabd763e99215488f06f119b8d66b';

UPDATE "DuelPackOutcome"
SET "valuationPolicyHash" = '0d8f1654c4d5c86622e207622bea835d029ecc78ed2ca1a24ba739a2c356c9fd'
WHERE "valuationPolicyHash" = '39186a3c3b133d001d3c17dd3832b45c2286e3df81ba13494e3cef638a48baf8';
