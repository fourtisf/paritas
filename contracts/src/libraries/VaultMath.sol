// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Constants} from "./Types.sol";

/// @notice Pure pricing math for AnchorVault. packages/shared/src/quote.ts is a line-by-line BigInt
/// port and spec/vectors/vault-quotes.json is checked by both test suites. Change both or neither.
///
/// cost (WAD fraction of the oracle price, never negative):
///   spread    = halfSpreadBps * spreadMulBps / 10_000           (in bps)
///   imbalance = (stockValue - usdValue) / (stockValue + usdValue) (-1..1, WAD)
///   buy cost  = spread - skewBps * imbalance                    (vault long stock -> cheaper to buy)
///   sell cost = spread + skewBps * imbalance
/// buy:  ask = ceil(price * (1 + cost));  out = floor(usdIn / ask)
/// sell: bid = floor(price * (1 - cost)); out = floor(stockIn * bid)
/// spreadShare = (notional at oracle - value given) * spreadShareBps / 10_000, in raw USDG
library VaultMath {
    uint256 internal constant WAD = Constants.WAD;
    uint256 internal constant BPS = Constants.BPS;

    struct Pool {
        uint256 priceWad; // USD per whole stock token, 18 decimals
        uint256 reserveStock; // raw
        uint256 reserveUsd; // raw
        uint256 stockUnit; // 10 ** stock decimals
        uint256 usdToWad; // 10 ** (18 - usd decimals)
    }

    struct Pricing {
        uint256 halfSpreadBps;
        uint256 skewBps;
        uint256 spreadMulBps;
        uint256 spreadShareBps;
    }

    struct Result {
        uint256 amountOut; // raw units of the output token
        uint256 notionalWad; // trade size in USD at the oracle price
        uint256 costWad; // all vault costs as a fraction of the oracle price
        int256 imbalanceWad;
        uint256 spreadShare; // raw USDG sent to the FeeCollector
    }

    function stockValueWad(Pool memory p) internal pure returns (uint256) {
        return Math.mulDiv(p.reserveStock, p.priceWad, p.stockUnit);
    }

    function navWad(Pool memory p) internal pure returns (uint256) {
        return stockValueWad(p) + p.reserveUsd * p.usdToWad;
    }

    function imbalanceWad(Pool memory p) internal pure returns (int256) {
        uint256 s = stockValueWad(p);
        uint256 u = p.reserveUsd * p.usdToWad;
        if (s + u == 0) return 0;
        return (int256(s) - int256(u)) * int256(WAD) / int256(s + u);
    }

    function spreadWad(Pricing memory q) internal pure returns (uint256) {
        // bps * mulBps / 1e4 * 1e14 = bps * mulBps * 1e10
        return q.halfSpreadBps * q.spreadMulBps * 1e10;
    }

    function cost(Pool memory p, Pricing memory q, bool buy) internal pure returns (uint256 c, int256 imb) {
        imb = imbalanceWad(p);
        int256 skew = int256(q.skewBps * Constants.BPS_TO_WAD) * imb / int256(WAD);
        int256 raw = int256(spreadWad(q)) + (buy ? -skew : skew);
        c = raw > 0 ? uint256(raw) : 0;
    }

    function quote(Pool memory p, Pricing memory q, bool buy, uint256 amountIn)
        internal
        pure
        returns (Result memory r)
    {
        (r.costWad, r.imbalanceWad) = cost(p, q, buy);
        if (buy) {
            uint256 usdInWad = amountIn * p.usdToWad;
            r.notionalWad = usdInWad;
            uint256 ask = Math.mulDiv(p.priceWad, WAD + r.costWad, WAD, Math.Rounding.Ceil);
            r.amountOut = Math.mulDiv(usdInWad, p.stockUnit, ask);
            uint256 fairWad = Math.mulDiv(r.amountOut, p.priceWad, p.stockUnit);
            uint256 revenueWad = usdInWad > fairWad ? usdInWad - fairWad : 0;
            r.spreadShare = revenueWad * q.spreadShareBps / BPS / p.usdToWad;
        } else {
            r.notionalWad = Math.mulDiv(amountIn, p.priceWad, p.stockUnit);
            uint256 bid = Math.mulDiv(p.priceWad, WAD - r.costWad, WAD);
            r.amountOut = Math.mulDiv(amountIn, bid, p.stockUnit) / p.usdToWad;
            uint256 paidWad = r.amountOut * p.usdToWad;
            uint256 revenueWad = r.notionalWad > paidWad ? r.notionalWad - paidWad : 0;
            r.spreadShare = revenueWad * q.spreadShareBps / BPS / p.usdToWad;
        }
    }

    /// @dev Deposits are priced like a trade with the vault so a stale oracle cannot be farmed:
    /// the depositor's stock is valued at the bid, the vault's stock at the ask (spread only, no skew).
    function depositShares(Pool memory p, Pricing memory q, uint256 usdIn, uint256 stockIn, uint256 supply)
        internal
        pure
        returns (uint256 shares, uint256 valueWad)
    {
        uint256 s = spreadWad(q);
        uint256 bid = Math.mulDiv(p.priceWad, WAD - s, WAD);
        uint256 ask = Math.mulDiv(p.priceWad, WAD + s, WAD, Math.Rounding.Ceil);
        valueWad = usdIn * p.usdToWad + Math.mulDiv(stockIn, bid, p.stockUnit);
        if (supply == 0) return (valueWad, valueWad); // caller burns MIN_LIQUIDITY
        uint256 navAtAsk = p.reserveUsd * p.usdToWad + Math.mulDiv(p.reserveStock, ask, p.stockUnit, Math.Rounding.Ceil);
        shares = navAtAsk == 0 ? 0 : Math.mulDiv(valueWad, supply, navAtAsk);
    }
}
