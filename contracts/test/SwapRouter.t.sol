// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Base} from "./Base.t.sol";
import {Venue, Leg, SwapParams, RfqQuote} from "../src/libraries/Types.sol";
import {VaultMath} from "../src/libraries/VaultMath.sol";
import {SwapRouter} from "../src/SwapRouter.sol";
import "../src/libraries/Errors.sol";

contract SwapRouterTest is Base {
    // ---------------------------------------------------------------- vault legs

    function test_BuyFromVault_matchesPreviewAndPaysFees() public {
        uint256 amountIn = 10_000e6;
        VaultMath.Result memory pre = nvdaVault.previewSwap(true, _net(amountIn));
        uint256 feesBefore = usdg.balanceOf(address(d.feeCollector));

        uint256 out = _swap(_oneLeg(address(nvda), true, amountIn, Venue.Vault, ""));

        assertEq(out, pre.amountOut, "executes exactly the preview");
        assertEq(nvda.balanceOf(trader), 5_000e18 + out);
        uint256 protocolFee = amountIn * 2 / 10_000;
        assertEq(usdg.balanceOf(address(d.feeCollector)) - feesBefore, protocolFee + pre.spreadShare);
        // ~10 bps half spread on a near-balanced vault: 10k USDG buys ~54.77 NVDA at 182.40
        assertApproxEqRel(out, 54.77e18, 0.001e18);
        _assertRouterEmpty();
    }

    function test_SellToVault_feeTakenFromOutput() public {
        uint256 amountIn = 20e18;
        VaultMath.Result memory pre = nvdaVault.previewSwap(false, amountIn);
        uint256 before = usdg.balanceOf(trader);

        uint256 out = _swap(_oneLeg(address(nvda), false, amountIn, Venue.Vault, ""));

        uint256 fee = pre.amountOut * 2 / 10_000;
        assertEq(out, pre.amountOut - fee);
        assertEq(usdg.balanceOf(trader) - before, out);
        _assertRouterEmpty();
    }

    function test_EmitsReceiptEvents() public {
        vm.recordLogs();
        _swap(_oneLeg(address(nvda), true, 5_000e6, Venue.Vault, ""));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 fills;
        uint256 routes;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(d.router)) continue;
            if (logs[i].topics[0] == SwapRouter.Fill.selector) fills++;
            if (logs[i].topics[0] == SwapRouter.RouteExecuted.selector) routes++;
        }
        assertEq(fills, 1);
        assertEq(routes, 1);
    }

    function test_RevertWhen_LegsDoNotSumToNetInput() public {
        SwapParams memory p = _oneLeg(address(nvda), true, 10_000e6, Venue.Vault, "");
        p.legs[0].amountIn = 10_000e6; // forgot to subtract the protocol fee
        _swapReverts(p, abi.encodeWithSelector(LegSumMismatch.selector, 10_000e6, _net(10_000e6)));
    }

    function test_RevertWhen_Expired() public {
        SwapParams memory p = _oneLeg(address(nvda), true, 1_000e6, Venue.Vault, "");
        p.deadline = block.timestamp - 1;
        vm.prank(trader);
        vm.expectRevert(Expired.selector);
        d.router.swap(p);
    }

    function test_RevertWhen_BelowMinimum() public {
        SwapParams memory p = _oneLeg(address(nvda), true, 1_000e6, Venue.Vault, "");
        p.minAmountOut = 6e18; // 1k USDG cannot buy 6 NVDA at 182
        vm.prank(trader);
        vm.expectRevert();
        d.router.swap(p);
    }

    function test_RevertWhen_TraderNotEligible() public {
        usdg.mint(outsider, 1_000e6);
        SwapParams memory p = _oneLeg(address(nvda), true, 1_000e6, Venue.Vault, "");
        p.recipient = outsider;
        vm.startPrank(outsider);
        usdg.approve(address(d.router), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(NotEligible.selector, outsider));
        d.router.swap(p);
        vm.stopPrank();
    }

    function test_RevertWhen_RecipientNotEligible() public {
        SwapParams memory p = _oneLeg(address(nvda), true, 1_000e6, Venue.Vault, "");
        p.recipient = outsider;
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(NotEligible.selector, outsider));
        d.router.swap(p);
    }

    function test_RevertWhen_AboveVaultClip() public {
        // tier A clip 50k in Regular
        _swapReverts(_oneLeg(address(nvda), true, 60_000e6, Venue.Vault, ""), "");
    }

    function test_OvernightHalvesClipAndDoublesSpread() public {
        uint256 regularOut = nvdaVault.previewSwap(true, 10_000e6).amountOut;
        vm.warp(OVERNIGHT_TS);
        _refreshFeeds();
        VaultMath.Result memory r = nvdaVault.previewSwap(true, 10_000e6);
        assertLt(r.amountOut, regularOut);
        assertApproxEqAbs(r.costWad, 20e14, 0.1e14, "about 2 x 10 bps");
        vm.expectRevert();
        nvdaVault.previewSwap(true, 30_000e6); // > 25k overnight clip
    }

    function test_WaveTwoMarketHasNoVaultButUniswapWorks() public {
        _swapReverts(_oneLeg(address(pltr), true, 1_000e6, Venue.Vault, ""), abi.encodeWithSelector(NoVault.selector));
        uint256 out = _swap(_oneLeg(address(pltr), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(3000))));
        assertGt(out, 0);
    }

    // ---------------------------------------------------------------- sessions

    function test_WeekendClosesVaultButUniswapRoutes() public {
        // Chainlink equity feeds stop at the Friday close; the band check accepts the last price
        uint256 fridayClose = 1792526400 + 3 days; // Fri 2026-10-23 16:00 NY
        nvdaFeed.set(int256(NVDA_PRICE), fridayClose);
        vm.warp(CLOSED_TS);

        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Vault, ""), abi.encodeWithSelector(VaultClosed.selector));

        uint256 out = _swap(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))));
        assertGt(out, 0);
    }

    function test_HolidayIsClosed() public {
        vm.warp(1795705200); // Thu 2026-11-26 10:00 NY, Thanksgiving
        _refreshFeeds();
        assertEq(uint8(d.sessions.current()), 3);
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Vault, ""), abi.encodeWithSelector(VaultClosed.selector));
    }

    // ---------------------------------------------------------------- band

    function test_RevertWhen_UniswapLegOutsideBand() public {
        _setUniCost(nvda, NVDA_PRICE, 80); // 80 bps + 2 fee > 75 band
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))), abi.encodeWithSelector(OutsideBand.selector, 0));
    }

    function test_BandEdge() public {
        _setUniCost(nvda, NVDA_PRICE, 72); // 72 + 2 = 74 <= 75
        _swap(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))));
        _setUniCost(nvda, NVDA_PRICE, 74); // 74 + 2 = 76 > 75
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))), abi.encodeWithSelector(OutsideBand.selector, 0));
    }

    function test_RevertWhen_OracleTooOldForBand() public {
        nvdaFeed.set(int256(NVDA_PRICE), block.timestamp);
        vm.warp(block.timestamp + 4 days + 1);
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))), "");
    }

    // ---------------------------------------------------------------- split route

    function test_SplitAcrossVaultUniswapAndMaker() public {
        uint256 amountIn = 100_000e6;
        uint256 net = _net(amountIn);
        uint256 vaultPart = 40_000e6;
        uint256 rfqPart = 30_000e6;
        uint256 uniPart = net - vaultPart - rfqPart;

        RfqQuote memory q = _quote(true, rfqPart, 164e18, 1); // ~ 182.93 per share, about 29 bps
        SwapParams memory p;
        p.stock = address(nvda);
        p.buy = true;
        p.amountIn = amountIn;
        p.recipient = trader;
        p.deadline = block.timestamp + 60;
        p.legs = new Leg[](3);
        p.legs[0] = Leg(Venue.Vault, vaultPart, "");
        p.legs[1] = Leg(Venue.Uniswap, uniPart, abi.encode(uint24(500)));
        p.legs[2] = Leg(Venue.Rfq, rfqPart, abi.encode(q, _signQuote(q)));

        uint256 expectVault = nvdaVault.previewSwap(true, vaultPart).amountOut;
        uint256 before = nvda.balanceOf(trader);
        uint256 out = _swap(p);
        assertEq(nvda.balanceOf(trader) - before, out);
        assertGe(out, expectVault + 164e18);
        _assertRouterEmpty();
    }

    // ---------------------------------------------------------------- pauses

    function test_GuardianPausesButCannotUnpause() public {
        vm.prank(guardian);
        d.params.pauseAll();
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Vault, ""), abi.encodeWithSelector(MarketPaused.selector));

        vm.prank(guardian);
        vm.expectRevert();
        d.params.unpauseAll();

        _govern(address(d.params), abi.encodeCall(d.params.unpauseAll, ()));
        _refreshFeeds();
        _swap(_oneLeg(address(nvda), true, 1_000e6, Venue.Vault, ""));
    }

    function test_MarketPauseIsPerMarket() public {
        vm.prank(guardian);
        d.params.pauseMarket(address(nvda));
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))), abi.encodeWithSelector(MarketPaused.selector));
        _swap(_oneLeg(address(pltr), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(3000))));
    }

    // ---------------------------------------------------------------- oracle

    function test_SequencerDownBlocksTrading() public {
        seqFeed.setStatus(1, block.timestamp);
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))), abi.encodeWithSelector(SequencerDown.selector));
    }

    function test_SequencerGracePeriod() public {
        seqFeed.setStatus(0, block.timestamp - 10 minutes); // just came back up
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))), abi.encodeWithSelector(SequencerGracePeriod.selector));
    }

    function test_IssuerOraclePauseClosesVaultOnly() public {
        nvda.setOraclePaused(true);
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Vault, ""), abi.encodeWithSelector(OraclePausedByIssuer.selector));
        _swap(_oneLeg(address(nvda), true, 1_000e6, Venue.Uniswap, abi.encode(uint24(500))));
    }

    function test_StaleOracleClosesVault() public {
        vm.warp(block.timestamp + 3601);
        _swapReverts(_oneLeg(address(nvda), true, 1_000e6, Venue.Vault, ""), "");
    }

    // ---------------------------------------------------------------- helpers

    function _assertRouterEmpty() internal view {
        assertEq(usdg.balanceOf(address(d.router)), 0, "router keeps no USDG");
        assertEq(nvda.balanceOf(address(d.router)), 0, "router keeps no stock");
    }
}
