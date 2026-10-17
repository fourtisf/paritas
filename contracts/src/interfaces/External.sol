// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// @notice Chainlink Data Feeds (and the L2 sequencer uptime feed) interface.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Robinhood Stock Token extras.
/// VERIFY ON BLOCKSCOUT before mainnet: read both functions on a live stock token contract and confirm
/// (1) oraclePaused() is the issuer's advisory "do not trust the price right now" flag, and
/// (2) uiMultiplier() scale (we assume 1e18 = 1 share per token) and whether price * multiplier is the
///     per-token price. OracleRouter only applies the multiplier when a market is configured with useMultiplier.
interface IStockToken {
    function oraclePaused() external view returns (bool);
    function uiMultiplier() external view returns (uint256);
}

/// @notice Uniswap v3 SwapRouter02 (IV3SwapRouter). This struct has NO deadline field.
/// VERIFY which router Uniswap deployed on Robinhood Chain. If only the Universal Router exists,
/// write a UniversalRouterAdapter with the same IVenueAdapter interface instead.
interface IV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Any external venue the router can use. Tokens are sent to the adapter before the call;
/// the adapter must send the output to `to` and return the amount.
interface IVenueAdapter {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, address to, bytes calldata data)
        external
        returns (uint256 amountOut);
}
