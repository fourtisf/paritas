/**
 * Plain-language messages for every Paritas revert, in the prototype's voice. Use with viem:
 *   const e = decodeErrorResult({ abi: paritasErrorsAbi, data }); explainError(e.errorName)
 * Wallet rejections and RPC errors are not contract errors; handle those separately.
 */
export const ERROR_COPY: Record<string, string> = {
  Expired: "The quote expired before your transaction landed. Get a new quote and try again.",
  InsufficientOutput: "The price moved past your slippage limit, so nothing was traded.",
  OutsideBand: "A venue's price was outside the price limit for this market, so the trade was stopped.",
  LegSumMismatch: "The route did not add up to your order size. Get a new quote.",
  BadLegs: "That route is not valid. Get a new quote.",
  MarketPaused: "Trading in this market is paused right now.",
  MarketNotListed: "This market is not listed on Paritas.",
  VaultClosed: "Vaults are paused right now. Uniswap pools and market makers can still fill your order.",
  NoVault: "This market does not have a vault yet.",
  AboveClip: "This order is larger than the vault takes in one fill. The router will split it or use another venue.",
  InsufficientInventory: "The vault does not hold enough of that token for this order.",
  AboveCap: "This deposit would take the vault over its cap.",
  SlippageExceeded: "The amounts moved since you previewed this. Review and try again.",
  NotEligible: "This wallet is not verified for stock tokens yet.",
  BadAttestation: "The eligibility check could not be verified. Start verification again.",
  StaleOracle: "The Chainlink price is out of date, so the vault is not quoting.",
  BadOracleAnswer: "The Chainlink price is not available right now.",
  NoFeed: "No Chainlink price is configured for this market.",
  SequencerDown: "Robinhood Chain is having trouble producing blocks. Trading is paused until it recovers.",
  SequencerGracePeriod: "Robinhood Chain just recovered. Trading resumes after a short safety window.",
  OraclePausedByIssuer: "The token issuer has paused its price. Vaults stop quoting until it resumes.",
  NotMaker: "That market maker is no longer approved.",
  WrongTaker: "That maker quote was made for a different wallet.",
  QuoteExpired: "The market maker's quote expired. Get a new quote.",
  NonceUsed: "That maker quote was already used or cancelled.",
  BadSignature: "The market maker's signature did not check out.",
  QuoteMismatch: "The maker quote does not match your order.",
  RfqSizeOutOfRange: "Market makers quote orders from 25,000 to 2,000,000 USDG.",
  ERC20InsufficientBalance: "Not enough balance for this transaction.",
  ERC20InsufficientAllowance: "Approve the token first.",
};

export const explainError = (name?: string) =>
  (name && ERROR_COPY[name]) || "The transaction did not go through. Nothing was traded.";
