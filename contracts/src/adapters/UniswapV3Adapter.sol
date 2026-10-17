// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IV3SwapRouter, IVenueAdapter} from "../interfaces/External.sol";
import {ZeroAddress, NotRouter} from "../libraries/Errors.sol";

/// @notice Fills a leg on a single Uniswap v3 pool through SwapRouter02.
/// amountOutMinimum is 0 on purpose: the SwapRouter checks the price band for this leg and the
/// route minimum right after this call, and the whole transaction reverts if either fails.
contract UniswapV3Adapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    address public immutable router;
    IV3SwapRouter public immutable swapRouter;

    constructor(address router_, address swapRouter_) {
        if (router_ == address(0) || swapRouter_ == address(0)) revert ZeroAddress();
        router = router_;
        swapRouter = IV3SwapRouter(swapRouter_);
    }

    /// @param data abi.encode(uint24 poolFee) e.g. 500 for the 0.05% pool
    function swap(address tokenIn, address tokenOut, uint256 amountIn, address to, bytes calldata data)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != router) revert NotRouter();
        uint24 fee = abi.decode(data, (uint24));
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        amountOut = swapRouter.exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: to,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }
}
