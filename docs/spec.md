# Ecrin: spec

Ecrin is the product (wallet vault + protocol); Cooldown is its headline feature.

The living version of this spec is in the shared doc; this file is the snapshot that lives with the code.

## Rules (enforced by `crates/vault-core`)

- Funds live in a program-owned PDA per owner. No receipt token is ever minted.
- `send_to_trusted`: instant, only to an address already in the trusted list, blocked while locked, counts against the daily limit. Refused when "trusted sends also wait" is on (the owner requests a normal withdrawal instead).
- `request_withdrawal`: queued; runs at `now + withdraw_delay`, or when the lock ends if later. Queued amounts are reserved.
- `cancel_withdrawal`: the owner can cancel any queued withdrawal at any time.
- `execute_withdrawal`: anyone can run it once due (a crank); the money only goes to the owner's chosen address. A lock added after the request still holds it back.
- `guardian_release`: the guardian co-signs a withdrawal the owner requested and it runs now (the emergency exit). The guardian cannot create a withdrawal or change its amount or destination. Refused when "no emergency exit" is on.
- Strict options `trusted_waits` and `no_exit`: turning either on is stricter and applies at once; turning it off is looser, waits for the rule delay and never applies before the lock ends. The guardian can't hurry it. The "Locked, no exit" preset is a lock with `no_exit` on, and needs no guardian. On Sui the two options live in a dynamic field of the Safe (`StrictKey`), with their own queue (`set_trusted_waits`, `set_no_exit`, `apply_strict_change`, `cancel_strict_change`). They ship as a fresh package, never as an upgrade of the live one: Sui keeps every published version callable on the same objects, so the old `send_to_trusted` and `guardian_release` would ignore the options.
- `propose_change`: stricter changes apply at once; looser ones wait `rule_delay`, and never before the lock ends.
  - Stricter: longer delays, a lower or new daily limit, a later or new lock, removing a trusted address, turning a strict option on.
  - Looser: everything else, including adding a trusted address and any guardian change. Adding a guardian waits too: a guardian can release a withdrawal at once, so a key thief who could name their own wallet as guardian would skip every delay.
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
