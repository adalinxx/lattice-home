# Lattice Token Pages

Chain-specific Buy and Sell pages linked from the Lattice explorer. Each child token is exchanged only with its direct parent's token. The pages never handle keys, construct signed transaction bodies, or submit transactions.

The two supported order paths map directly to Lattice consensus actions:

- **Sell child · limit:** stage a child-chain `DepositAction`. `amountDeposited` is the child LAT offered and `amountDemanded` is the exact parent LAT required.
- **Buy child · market:** select compatible active deposits, create a parent-chain `ReceiptAction` that pays the seller, then complete a child-chain `WithdrawalAction` for the buyer.

The wallet independently verifies active deposits, selects nodes, calculates fees and nonces, constructs the actions, obtains user approval, signs, submits, and persists settlement through deposit → receipt → withdrawal.

## Development

```sh
npm install
npm run dev
```

## Wallet handoff

Every reviewed order becomes a draggable and copyable `lattice://order` string plus a QR code. No website bridge or account permission is required. Open the wallet in a tab and drag the handoff card into it, or use QR/copy as fallbacks. The request contains the expiring high-level intent—not keys, signatures, nonces, node URLs, fees, or final transaction bodies. The wallet must import it, independently verify current chain state and offers, reconstruct the actions, choose the account, and obtain approval.

Each token page covers one direct parent/child edge. The node exposes active deposits but no separate DEX or order-book API; the page derives available offers from deposit state.

## Security boundary

- No private keys, seed phrases, or signing payloads enter this application.
- An intent contains no nonce, fee, node URL, transaction body, or preimage.
- Intent IDs are random and expire after 15 minutes.
- The wallet reconstructs and presents the final authorization details.
