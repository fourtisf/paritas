// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {Venue} from "../src/libraries/Types.sol";
import {AnchorVault} from "../src/AnchorVault.sol";
import "../src/libraries/Errors.sol";

contract AnchorVaultTest is Base {
    function test_FirstDepositLocksMinimumLiquidity() public view {
        assertEq(nvdaVault.balanceOf(0x000000000000000000000000000000000000dEaD), nvdaVault.MIN_LIQUIDITY());
    }

    function test_DepositPricedLikeATrade() public view {
        // depositing only USDG into a balanced vault: you pay the ask on the vault's stock half
        (uint256 shares, uint256 valueWad) = nvdaVault.previewDeposit(10_000e6, 0);
        assertEq(valueWad, 10_000e18);
        uint256 navWad = nvdaVault.navWad();
        uint256 fairShares = valueWad * nvdaVault.totalSupply() / navWad;
        assertLt(shares, fairShares, "slightly fewer shares than at the raw oracle price");
        assertGt(shares, fairShares * 9_990 / 10_000, "but within one spread");
    }

    function test_RevertWhen_DepositAboveCap() public {
        usdg.mint(lp, 2_000_000e6);
        vm.prank(lp);
        vm.expectRevert(AboveCap.selector);
        nvdaVault.deposit(1_300_000e6, 0, 0, lp); // 1.28M + 1.3M > 2.5M
    }

    function test_RevertWhen_DepositOnWeekend() public {
        vm.warp(CLOSED_TS);
        _refreshFeeds();
        vm.prank(lp);
        vm.expectRevert(VaultClosed.selector);
        nvdaVault.deposit(1_000e6, 0, 0, lp);
    }

    function test_RevertWhen_DepositorNotEligible() public {
        usdg.mint(outsider, 1_000e6);
        vm.startPrank(outsider);
        usdg.approve(address(nvdaVault), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(NotEligible.selector, outsider));
        nvdaVault.deposit(1_000e6, 0, 0, outsider);
        vm.stopPrank();
    }

    function test_WithdrawInKindWorksDuringPauseWeekendAndOracleOutage() public {
        vm.prank(guardian);
        d.params.pauseAll();
        vm.warp(CLOSED_TS);
        nvdaFeed.set(-1, block.timestamp); // broken feed
        seqFeed.setStatus(1, block.timestamp); // sequencer down

        uint256 shares = nvdaVault.balanceOf(lp) / 4;
        (uint256 u, uint256 s) = nvdaVault.previewWithdraw(shares);
        uint256 u0 = usdg.balanceOf(lp);
        uint256 s0 = nvda.balanceOf(lp);
        vm.prank(lp);
        nvdaVault.withdraw(shares, u, s, lp);
        assertEq(usdg.balanceOf(lp) - u0, u);
        assertEq(nvda.balanceOf(lp) - s0, s);
        assertApproxEqRel(u, 160_000e6, 0.001e18);
    }

    function test_RevertWhen_WithdrawToIneligibleReceiver() public {
        uint256 shares = nvdaVault.balanceOf(lp) / 10;
        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(NotEligible.selector, outsider));
        nvdaVault.withdraw(shares, 0, 0, outsider);
    }

    function test_SharesOnlyMoveBetweenEligibleWallets() public {
        vm.startPrank(lp);
        vm.expectRevert(abi.encodeWithSelector(NotEligible.selector, outsider));
        nvdaVault.transfer(outsider, 1e18);
        assertTrue(nvdaVault.transfer(trader, 1e18));
        vm.stopPrank();
    }

    function test_DonationDoesNotMoveSharePrice() public {
        (uint256 u0, uint256 s0) = nvdaVault.previewWithdraw(1e18);
        usdg.mint(address(nvdaVault), 500_000e6);
        (uint256 u1, uint256 s1) = nvdaVault.previewWithdraw(1e18);
        assertEq(u0, u1);
        assertEq(s0, s1);
    }

    function test_OnlyRouterCanSwap() public {
        vm.expectRevert(NotRouter.selector);
        nvdaVault.swap(true, address(this));
    }

    function test_SwapsGrowNavPerShareAtConstantPrice() public {
        uint256 supply = nvdaVault.totalSupply();
        uint256 nav0 = nvdaVault.navWad();
        for (uint256 i; i < 5; ++i) {
            _swap(_oneLeg(address(nvda), true, 20_000e6, Venue.Vault, ""));
            _swap(_oneLeg(address(nvda), false, 100e18, Venue.Vault, ""));
        }
        uint256 nav1 = nvdaVault.navWad();
        assertEq(nvdaVault.totalSupply(), supply);
        assertGt(nav1, nav0, "LPs earn the spread");
    }

    function test_SkewMakesTheHeavySideCheaper() public {
        // push the vault long stock by buying stock from traders (traders sell into the vault)
        for (uint256 i; i < 8; ++i) {
            _swap(_oneLeg(address(nvda), false, 200e18, Venue.Vault, ""));
        }
        uint256 buyCost = nvdaVault.previewSwap(true, 1_000e6).costWad;
        uint256 sellCost = nvdaVault.previewSwap(false, 5e18).costWad;
        assertLt(buyCost, 10e14, "buying from a long vault costs less than the base spread");
        assertGt(sellCost, 10e14, "selling into a long vault costs more");
    }
}
