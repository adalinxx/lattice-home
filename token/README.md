# Lattice Token Pages

Chain-specific Buy and Sell pages linked from the Lattice explorer. Each child token is exchanged only with its direct parent's token. The pages never handle keys, construct signed transaction bodies, or submit transactions; the Buy page makes read-only requests to public nodes.

The two order paths map directly to Lattice consensus actions:

- **Sell child · limit:** stage a child-chain `DepositAction`. `amountDeposited` is the child LAT offered and `amountDemanded` is the exact parent LAT required. The order carries these two amounts exactly. The form's exchange rate is a helper: it is filled in from the two amounts when empty, and once set it stays fixed while the two amounts follow each other through it, as on an exchange order form. Rounding to whole atomic units always favours the seller. The rate is never sent.
- **Buy child · selected deposits:** the Buy page lists the child chain's open sell deposits, cheapest first, and the user ticks the ones to buy. Each is bought whole. The request names those deposits exactly; the wallet creates a parent-chain `ReceiptAction` per deposit in one transaction, then completes a child-chain `WithdrawalAction` for the buyer.

The wallet independently verifies the selected deposits, selects nodes, calculates fees and nonces, constructs the actions, obtains user approval, signs, submits, and persists settlement through deposit → receipt → withdrawal.

### Buy list

The page reads, and does not verify:

1. the child chain's node, found by walking declared endpoints down from the Nexus read service (public https hosts only);
2. `GET /api/chain/info` and then `GET /api/deposits` on that node, all pages up to a bound, sorted by price with exact integer arithmetic. When a row carries `blockHeight` and `blockHash` (the block that created the deposit), the list shows confirmations: the node's tip height minus that height, plus one. Nodes that do not report it show a dash;
3. `GET /api/receipt-state` on the parent's node for each deposit about to be shown, so orders someone has already paid for are left out.

The list is a convenience. A node can omit or invent rows; the wallet must prove each selected deposit and that it is unpaid before it signs, and the parent chain rejects a second payment for the same deposit.

A buy request has this shape (amounts and nonces are decimal strings in atomic units):

```json
{
  "version": 1, "intentId": "…", "asset": "LAT", "expiresAt": "…",
  "parentChain": ["Nexus"], "childChain": ["Nexus", "Payments"],
  "side": "buy_child", "orderType": "take",
  "deposits": [{ "demander": "bafy…", "amountDemanded": "100000000", "amountDeposited": "300000000", "depositNonce": "8" }]
}
```

**Wallet support is pending.** Lattice Wallet currently accepts only the older market-buy request and answers this one with "The order side or type is unsupported". Buying from this page works once the wallet accepts `orderType: "take"`.

## Development

```sh
npm install
npm run dev
```

## Wallet handoff

Every reviewed order becomes a draggable and copyable `lattice://order` string plus a QR code. No website bridge or account permission is required. Open the wallet in a tab and drag the handoff card into it, or use QR/copy as fallbacks. The request contains the expiring high-level intent—not keys, signatures, nonces, node URLs, fees, or final transaction bodies. The wallet must import it, independently verify current chain state and offers, reconstruct the actions, choose the account, and obtain approval.

Each token page covers one direct parent/child edge. The node exposes active deposits but no separate DEX or order-book API; the Buy list is built from deposit state.

## Security boundary

- No private keys, seed phrases, or signing payloads enter this application.
- An intent contains no nonce, fee, node URL, transaction body, or preimage.
- Intent IDs are random and expire after 15 minutes.
- The `chain` URL parameter is accepted only as a well-formed path below Nexus, and page text built from it is escaped.
- The wallet reconstructs and presents the final authorization details.
