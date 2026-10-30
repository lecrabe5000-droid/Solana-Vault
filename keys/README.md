# Test-only keys

`localnet-program-keypair.json` fixes the program's address for local tests and CI, so `declare_id!`, Anchor.toml
and the deployed program always agree. It is public on purpose and worthless: **never deploy to devnet or mainnet
with it.** Devnet and mainnet get their own program keypair, kept out of the repo.
