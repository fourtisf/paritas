// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// @dev Trading session in New York time. `Closed` covers weekends and market holidays.
///      Order matters: the same numbers are used by the API, the indexer and the web app
///      (packages/shared/src/sessions.ts). Never reorder.
enum Session {
    Regular, // Mon-Fri 09:30-16:00 ET (13:00 on early-close days)
    Extended, // Mon-Fri 04:00-09:30 and 16:00-20:00 ET
    Overnight, // 20:00-04:00 ET, only when the next day is a trading day
    Closed // weekend and holidays: vaults do not quote, Uniswap and RFQ still route
}

/// @dev Where a leg of a route is filled. Never reorder (indexed in events).
enum Venue {
    Vault,
    Uniswap,
    Rfq
}

/// @dev Per-tier vault parameters, before session multipliers.
struct TierParams {
    uint16 halfSpreadBps; // vault half spread around the oracle price
    uint16 skewBps; // max inventory adjustment, applied as skewBps * imbalance
    uint16 bandBps; // max all-in cost of any leg versus the oracle price (incl. protocol fee)
    uint64 clipUsd; // largest vault fill, whole USD
    uint64 capUsd; // vault TVL cap for deposits, whole USD
}

/// @dev Session multipliers. 10_000 = x1.0.
struct SessionParams {
    uint32 spreadMulBps;
    uint32 clipMulBps;
    uint32 bandMulBps;
    bool vaultOpen;
}

struct Market {
    bool listed;
    bool paused;
    uint8 tier; // 0 = A, 1 = B, 2 = C
}

/// @dev One leg of a route. The off-chain router (API /quote) builds legs; the contract
///      enforces sizes, the price band per leg, the total minimum and the fees.
///      data: Vault -> empty; Uniswap -> abi.encode(uint24 poolFee); Rfq -> abi.encode(RfqQuote, bytes signature)
struct Leg {
    Venue venue;
    uint256 amountIn;
    bytes data;
}

struct SwapParams {
    address stock; // the stock token; the other side is always USDG
    bool buy; // true: USDG -> stock, false: stock -> USDG
    uint256 amountIn; // raw units of the input token. On buys this includes the protocol fee.
    uint256 minAmountOut; // raw units, after all fees
    address recipient;
    uint256 deadline;
    Leg[] legs;
}

/// @dev EIP-712 signed by the maker. Single use, bound to one taker (the trader's wallet).
struct RfqQuote {
    address maker;
    address taker;
    address stock;
    bool takerBuys; // true: taker pays USDG and receives stock
    uint256 amountIn; // what the taker pays, raw units
    uint256 amountOut; // what the taker receives, raw units
    uint256 nonce;
    uint256 expiry; // unix seconds
}

library Constants {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS_TO_WAD = 1e14; // 1 bps as a WAD fraction
}
