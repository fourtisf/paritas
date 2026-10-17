// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IV3SwapRouter} from "../interfaces/External.sol";

// Test and local-chain (anvil) mocks only. Never deploy to testnet or mainnet.

contract MockERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Mirrors the two Robinhood Stock Token extras we rely on.
contract MockStockToken is MockERC20 {
    bool public oraclePaused;
    uint256 public uiMultiplier = 1e18;

    constructor(string memory n, string memory s) MockERC20(n, s, 18) {}

    function setOraclePaused(bool p) external {
        oraclePaused = p;
    }

    function setUiMultiplier(uint256 m) external {
        uiMultiplier = m;
    }
}

contract MockAggregator {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint256 public startedAt;

    constructor(uint8 d, int256 a) {
        decimals = d;
        answer = a;
        updatedAt = block.timestamp;
        startedAt = block.timestamp;
    }

    function set(int256 a, uint256 t) external {
        answer = a;
        updatedAt = t;
    }

    /// @dev for the sequencer uptime feed: answer 0 = up, 1 = down; startedAt = when the status began
    function setStatus(int256 a, uint256 started) external {
        answer = a;
        startedAt = started;
        updatedAt = block.timestamp;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, updatedAt, 1);
    }
}

/// @dev Fills exactInputSingle at a fixed rate from its own balance (not a real AMM; no price impact).
/// rate = tokenOut raw per 1e18 tokenIn raw, set per direction.
contract MockV3SwapRouter is IV3SwapRouter {
    using SafeERC20 for IERC20;

    mapping(address => mapping(address => uint256)) public rate;

    function setRate(address tokenIn, address tokenOut, uint256 outPer1e18In) external {
        rate[tokenIn][tokenOut] = outPer1e18In;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        IERC20(p.tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);
        amountOut = Math.mulDiv(p.amountIn, rate[p.tokenIn][p.tokenOut], 1e18);
        require(amountOut >= p.amountOutMinimum, "Too little received");
        IERC20(p.tokenOut).safeTransfer(p.recipient, amountOut);
    }
}
