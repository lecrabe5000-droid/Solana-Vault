# Cooldown Vault: spec

The living version of this spec is in the shared doc; this file is the snapshot that lives with the code.

## Rules (enforced by `crates/vault-core`)

- Funds live in a program-owned PDA per owner. No receipt token is ever minted.
- `send_to_trusted`: instant, only to an address already in the trusted list, blocked while locked, counts against the daily limit.
- `request_withdrawal`: queued; runs at `now + withdraw_delay`, or when the lock ends if later. Queued amounts are reserved.
- `cancel_withdrawal`: the owner can cancel any queued withdrawal at any time.
- `execute_withdrawal`: anyone can run it once due (a crank); the money only goes to the owner's chosen address. A lock added after the request still holds it back.
- `guardian_release`: the guardian co-signs a withdrawal the owner requested and it runs now (the emergency exit). The guardian cannot create a withdrawal or change its amount or destination.
- `propose_change`: stricter changes apply at once; looser ones wait `rule_delay`, and never before the lock ends.
  - Stricter: longer delays, a lower or new daily limit, a later or new lock, adding a guardian where there was none, removing a trusted address.
  - Looser: everything else, including adding a trusted address and removing or swapping the guardian.
- `guardian_approve_change`: the guardian can approve only `AddTrusted` early. Every other loosening always waits.
- Limits: 8 trusted addresses, 4 pending withdrawals, 4 pending changes. Delays between 1 hour and 365 days.

## Honest limits

- The vault protects money inside it, not new income. Auto-routing deposits in is on the roadmap.
- A determined user can still request a withdrawal and wait. The product buys time for the urge to pass and for a guardian to step in.

## Open questions

- Lost keys: recovery through the guardian plus a long delay; exact flow not designed yet.
- Free, or a small fee on deposits?
- Partner with gambling-support charities for testing and referrals?
- Legal review of how the product is described before launch.
