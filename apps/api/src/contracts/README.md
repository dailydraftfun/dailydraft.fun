# Vendored escrow contract surface

The `-v2` suffix on `dailydraft-escrow-v2.ts` is historical and kept for import stability, but the
instruction vectors and PDA derivations are pinned to Duel v4 from the verified GitHub Actions
artifact for
[`dailydraftfun/escrow@5268637d961672588c70a1c3b1ccbf6d6ab5f5cb`](https://github.com/dailydraftfun/escrow/commit/5268637d961672588c70a1c3b1ccbf6d6ab5f5cb).

The artifact and IDL filenames below are recorded exactly as that build emitted them, under the
pre-rebrand name. They identify files the SHA-256 was taken over, so they are history rather than
branding and do not move with the rename.

- Duel account version: `4`
- Artifact: `openpacksduel-escrow-5268637d961672588c70a1c3b1ccbf6d6ab5f5cb`
- IDL file: `openpacksduel_escrow.json`
- IDL SHA-256: `f16eda95787367db629051203dac8a5db61794f1c048528ecfecd868245e070d`
- Program: `Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS`

The artifact's `SHA256SUMS` was verified before this surface was copied. The full IDL and program
binary remain in the public escrow repository's release artifact and are intentionally not vendored
here.
