# For the geldar orchestrator: per-blob cap in the verify gate

What: `geldar-verify` now rejects any new blob larger than 2 MiB (`MAX_BLOB_BYTES`), reason `bundle_too_large`. The spec only limits the bundle (50 MiB).

Why: a bundle-only cap is no cap on the result. Exploit in 3 lines: the agent commits a 200 MiB blob of zeros under memory/; it compresses to a tiny bundle that passes the 50 MiB cap; the fast-forward inflates it into the human's clone, and a few of them fill the disk.

Proposed record text: "The verify gate also refuses any new blob over 2 MiB (2097152 bytes). No legitimate memory, skill or journal file approaches it. This tightens the bundle size limit of the spec (H-10); the reason id is the existing bundle_too_large."
