# Escrow lifecycle

The contract is the authority for acceptance, deposits, payment, and refunds. The database stores the private brief, evidence links, and revision notes, and it indexes chain events. A database flag cannot fund, pay, or refund.

## States

Agreement: draft (offchain) → awaiting the client's onchain acceptance → active.

A milestone starts unfunded. After both parties have accepted the same `termsHash`:

Unfunded → Funded → Submitted → Paid

Revision: Submitted → Changes requested → Submitted

Cancellation is a side proposal on an unpaid funded milestone (Funded, Submitted, or Changes requested). It is not a second balance.

## Who may act

| Action | Caller | Preconditions |
| --- | --- | --- |
| Create and commit | Freelancer | Client is a different address. Token is the allowlisted test token. Amounts are non-zero. |
| Accept | Designated client | `termsHash` equals the stored hash. Not already accepted. |
| Fund | Designated client | Accepted. Milestone is unfunded. Transfer is the exact amount. |
| Submit | Designated freelancer | Milestone is funded or changes were requested. Reference is a non-zero hash. |
| Request changes | Designated client | Milestone is submitted. |
| Release | Designated client | Milestone is submitted. Pays the full amount to the freelancer once. |
| Propose cancel | Either party | Milestone holds funds and is not paid or refunded. |
| Approve cancel | The other party | Same milestone and the current proposal nonce. |
| Withdraw proposal | The proposer | Clears the proposer. Does not move funds. |

## Acceptance

`createAgreement` records the freelancer (`msg.sender`), client, token, terms hash, and amounts. That transaction is the freelancer's commitment. `accept` succeeds only for the client and only when the hash matches. Funding reverts before both of those are true.

Private title, description, deliverable text, and links stay offchain. The hash commits to that canonical JSON.

## Cancellation races

Each proposal stores a nonce and the proposer. Replacing or re-proposing increments the nonce and sets the new proposer. Approval must pass the current nonce. An approval of an older nonce reverts.

Withdrawing sets the proposer to the zero address and increments the nonce, so an in-flight approval of the withdrawn proposal cannot land later.

Submit, request-changes, release, and a successful refund also increment the nonce and clear the proposer. A cancellation approval and a payment can race. The first transaction that lands changes the phase. The second reverts. Neither can run twice.

A proposal alone does not transfer tokens. Paid and refunded milestones cannot be cancelled.

## Accounting

Each milestone has its own amount and phase. Funding pulls that amount from the client. Release pays that amount to the freelancer. Refund pays that amount to the client. The contract does not keep a surplus and has no admin withdrawal.

## Deadlines

Due dates are offchain and informational. The contract has no timeout payout or timeout refund.

## Token

One ERC-20 is fixed at deployment. It is a test token named ProofPay Test Token (`tUSDC`) with 6 decimals and no monetary value. Funding uses `safeTransferFrom` for the exact milestone amount. The app requests that exact allowance, not an unlimited approval.
