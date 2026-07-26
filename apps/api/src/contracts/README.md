# Vendored escrow contract surface

The `-v2` suffix on `dailydraft-escrow-v2.ts` is historical and kept for import stability, but the
instruction vectors and PDA derivations are pinned to Duel v4 from the verified GitHub Actions
artifact for
[`dailydraftfun/escrow@db8d0eec1d0ed856a58e3a40b34e24b62023bb49`](https://github.com/dailydraftfun/escrow/commit/db8d0eec1d0ed856a58e3a40b34e24b62023bb49).

- Duel account version: `4`
- Artifact: `dailydraft-escrow-db8d0eec1d0ed856a58e3a40b34e24b62023bb49`
- IDL file: `dailydraft_escrow.json`
- IDL SHA-256: `dbd27bbc7b3c5b52b5d7a839c7c53daef09eb7228be99525873ffe2b4d6058d8`
- Program: `Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS`

That build republished the program under its DailyDraft name. The regenerated IDL is byte-identical
to the one it replaced apart from `metadata.name`, `metadata.description` and `metadata.repository`:
the program address, accounts, instructions and discriminators are unchanged, because Anchor derives
discriminators from instruction and struct names rather than from the crate name. The constants
below therefore did not move with the rename, and the deployed program stays compatible with clients
built against either IDL.

The artifact's `SHA256SUMS` was verified before this surface was copied. The full IDL and program
binary remain in the public escrow repository's release artifact and are intentionally not vendored
here.
