// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Base} from "./Base.t.sol";
import {Venue, Leg, SwapParams} from "../src/libraries/Types.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {EligibilityRegistry} from "../src/EligibilityRegistry.sol";
import {IV3SwapRouter} from "../src/interfaces/External.sol";
import "../src/libraries/Errors.sol";

/// @dev Like MockV3SwapRouter (same storage: rate at slot 0), but the "pool" can only absorb capIn of an input
/// token: what a v3 pool does on an exact-input swap with no price limit once its liquidity runs out.
contract PartialFillRouter is IV3SwapRouter {
    using SafeERC20 for IERC20;

    mapping(address => mapping(address => uint256)) public rate;
    mapping(address => uint256) public capIn;

    function setCap(address tokenIn, uint256 cap) external {
        capIn[tokenIn] = cap;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        uint256 used = capIn[p.tokenIn] != 0 && p.amountIn > capIn[p.tokenIn] ? capIn[p.tokenIn] : p.amountIn;
        IERC20(p.tokenIn).safeTransferFrom(msg.sender, address(this), used);
        amountOut = Math.mulDiv(used, rate[p.tokenIn][p.tokenOut], 1e18);
        IERC20(p.tokenOut).safeTransfer(p.recipient, amountOut);
    }
}

/// @dev A Chainlink-style proxy that can be pointed at an aggregator with other decimals.
contract RepointableFeed {
    uint8 public decimals;
    int256 public answer;
    uint256 public updatedAt;

    constructor(uint8 d, int256 a) {
        set(d, a);
    }

    function set(uint8 d, int256 a) public {
        decimals = d;
        answer = a;
        updatedAt = block.timestamp;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @notice Regression tests for the fixes from the internal security review (docs/SECURITY_REVIEW.md).
contract ReviewTest is Base {
    // ---------------------------------------------------------------- R1 Uniswap partial fill

    function test_RevertWhen_UniswapPoolTakesOnlyPartOfTheLeg() public {
        vm.etch(address(uni), address(new PartialFillRouter()).code);
        PartialFillRouter(address(uni)).setCap(address(usdg), 99_500e6);
        SwapParams memory p = _oneLeg(address(nvda), true, 100_000e6, Venue.Uniswap, abi.encode(uint24(500)));
        _swapReverts(p, abi.encodeWithSelector(PartialFill.selector, 99_500e6, p.legs[0].amountIn));
        assertEq(usdg.balanceOf(address(d.uniswapAdapter)), 0, "nothing left in the adapter");
    }

    function test_UniswapLegLeavesNoAllowance() public {
        _swap(_oneLeg(address(nvda), true, 10_000e6, Venue.Uniswap, abi.encode(uint24(500))));
        assertEq(usdg.allowance(address(d.uniswapAdapter), address(uni)), 0);
        assertEq(usdg.balanceOf(address(d.uniswapAdapter)), 0);
    }

    // ---------------------------------------------------------------- R2 tokens sent straight to a vault

    function test_TokensSentToTheVaultNeverReachATrade() public {
        uint256 out0 = nvdaVault.previewSwap(false, 1e18).amountOut;
        nvda.mint(outsider, 300e18); // more than one tier A clip, sent outside deposit()
        vm.prank(outsider);
        nvda.transfer(address(nvdaVault), 300e18);

        // a 1-wei sell is priced as 1 wei: it does not collect the 300 tokens
        _swapReverts(_oneLeg(address(nvda), false, 1, Venue.Vault, ""), abi.encodeWithSelector(ZeroAmount.selector));
        // and the vault still trades normally in that direction (before the fix every sell reverted AboveClip)
        uint256 out = _swap(_oneLeg(address(nvda), false, 1e18, Venue.Vault, ""));
        assertEq(out, out0 - out0 * d.params.protocolFeeBps() / 10_000, "same price as before the transfer");
        assertEq(nvda.balanceOf(address(nvdaVault)) - nvdaVault.reserveStock(), 300e18, "the transfer stays outside the reserves");
    }

    function test_UsdgSentToTheVaultDoesNotBlockBuys() public {
        usdg.mint(outsider, 60_000e6);
        vm.prank(outsider);
        usdg.transfer(address(nvdaVault), 60_000e6);
        assertGt(_swap(_oneLeg(address(nvda), true, 1_000e6, Venue.Vault, "")), 0);
    }

    // ---------------------------------------------------------------- R3 one vault leg per route

    function test_RevertWhen_RouteHasTwoVaultLegs() public {
        SwapParams memory p = _oneLeg(address(nvda), true, 98_000e6, Venue.Vault, "");
        uint256 net = p.legs[0].amountIn;
        p.legs = new Leg[](2);
        p.legs[0] = Leg(Venue.Vault, 49_000e6, "");
        p.legs[1] = Leg(Venue.Vault, net - 49_000e6, "");
        _swapReverts(p, abi.encodeWithSelector(BadLegs.selector));
    }

    // ---------------------------------------------------------------- R4 stock splits (uiMultiplier)

    function test_SplitClosesTheVaultUntilGovernanceConfirms() public {
        nvda.setUiMultiplier(2e18); // 2:1 split as a multiplier change
        nvdaFeed.set(int256(NVDA_PRICE / 2), block.timestamp); // per-share feed halves
        SwapParams memory p = _oneLeg(address(nvda), true, 10_000e6, Venue.Vault, "");
        _swapReverts(p, abi.encodeWithSelector(MultiplierChanged.selector, 2e18, 1e18));
        // Uniswap still routes, inside the band
        _setUniCost(nvda, NVDA_PRICE / 2, 15);
        assertGt(_swap(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500)))), 0);

        // governance re-arms the feed with the new multiplier applied
        _govern(address(d.oracle), abi.encodeCall(OracleRouter.setFeed, (address(nvda), address(nvdaFeed), true, true)));
        nvdaFeed.set(int256(NVDA_PRICE / 2), block.timestamp);
        (uint256 priceWad,) = d.oracle.price(address(nvda));
        assertEq(priceWad, NVDA_PRICE * 1e10, "per-token price = per-share price x multiplier");
        assertGt(_swap(_oneLeg(address(nvda), true, 10_000e6, Venue.Vault, "")), 0);
    }

    function test_RevertWhen_DepositAfterMultiplierChange() public {
        nvda.setUiMultiplier(5e17);
        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(MultiplierChanged.selector, 5e17, 1e18));
        nvdaVault.deposit(1_000e6, 0, 0, lp);
    }

    // ---------------------------------------------------------------- R5 attestations

    function test_RevokingAnAttesterRevokesItsAttestations() public {
        assertTrue(d.eligibility.isEligible(trader));
        vm.prank(guardian);
        d.eligibility.revokeAttester(attester);
        assertFalse(d.eligibility.isEligible(trader));
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))), "");
    }

    function test_RevertWhen_AttestationLongerThanMaxValidity() public {
        uint64 issuedAt = uint64(block.timestamp);
        uint64 until = issuedAt + d.eligibility.MAX_VALIDITY() + 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterPk, d.eligibility.attestationDigest(outsider, until, issuedAt));
        vm.expectRevert(BadAttestation.selector);
        d.eligibility.attest(outsider, until, issuedAt, abi.encodePacked(r, s, v));
    }

    function test_NewAttesterReplacesARevokedOne() public {
        vm.prank(guardian);
        d.eligibility.revokeAttester(attester);
        uint256 pk2 = 0xB0B;
        _govern(address(d.eligibility), abi.encodeCall(EligibilityRegistry.setAttester, (vm.addr(pk2), true)));
        uint64 issuedAt = uint64(block.timestamp);
        uint64 until = issuedAt + 30 days; // shorter than the revoked one's, still replaces it
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk2, d.eligibility.attestationDigest(trader, until, issuedAt));
        d.eligibility.attest(trader, until, issuedAt, abi.encodePacked(r, s, v));
        assertTrue(d.eligibility.isEligible(trader));
        assertEq(d.eligibility.attesterOf(trader), vm.addr(pk2));
        assertEq(d.eligibility.validUntil(trader), until);
    }

    // ---------------------------------------------------------------- R6 feed decimals

    function test_FeedDecimalsAreReadLive() public {
        RepointableFeed f = new RepointableFeed(8, int256(PLTR_PRICE));
        _govern(address(d.oracle), abi.encodeCall(OracleRouter.setFeed, (address(pltr), address(f), false, true)));
        f.set(8, int256(PLTR_PRICE));
        (uint256 p0,) = d.oracle.price(address(pltr));
        f.set(18, int256(PLTR_PRICE * 1e10)); // same price, now with 18 decimals
        (uint256 p1,) = d.oracle.price(address(pltr));
        assertEq(p1, p0);
        assertEq(p0, PLTR_PRICE * 1e10);
    }

    // ---------------------------------------------------------------- R7 blocked wallets

    function test_BlockedWalletWithdrawsOnlyToItself() public {
        address[] memory who = new address[](1);
        who[0] = lp;
        vm.prank(guardian);
        d.eligibility.blockAccounts(who);
        uint256 shares = nvdaVault.balanceOf(lp) / 10;

        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(NotEligible.selector, lp));
        nvdaVault.withdraw(shares, 0, 0, trader);

        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(NotEligible.selector, lp));
        nvdaVault.transfer(trader, shares);

        vm.prank(lp);
        (uint256 u, uint256 s) = nvdaVault.withdraw(shares, 0, 0, lp);
        assertGt(u + s, 0, "withdrawing to itself still works");
    }
}
