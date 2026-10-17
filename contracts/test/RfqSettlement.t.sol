// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {Venue, SwapParams, RfqQuote} from "../src/libraries/Types.sol";
import "../src/libraries/Errors.sol";

contract RfqSettlementTest is Base {
    /// @dev One RFQ leg. On buys the leg (and the quote's amountIn) is the input net of the protocol fee.
    function _params(RfqQuote memory q, bytes memory sig, uint256 amountIn) internal view returns (SwapParams memory) {
        return _oneLeg(address(nvda), q.takerBuys, amountIn, Venue.Rfq, abi.encode(q, sig));
    }

    function _sellQuote(uint256 nonce) internal view returns (RfqQuote memory q, bytes memory sig, SwapParams memory p) {
        q = _quote(false, 200e18, 36_400e6, nonce);
        sig = _signQuote(q);
        p = _params(q, sig, q.amountIn);
    }

    function test_TakerBuys_makerPaysRfqFee() public {
        uint256 amountIn = 50_000e6;
        RfqQuote memory q = _quote(true, _net(amountIn), 273e18, 7);
        SwapParams memory p = _params(q, _signQuote(q), amountIn);
        uint256 makerUsdBefore = usdg.balanceOf(maker);
        uint256 collectorBefore = usdg.balanceOf(address(d.feeCollector));

        uint256 out = _swap(p);

        assertEq(out, 273e18, "taker gets exactly the signed amount");
        uint256 rfqFee = q.amountIn * 2 / 10_000;
        uint256 protocolFee = amountIn - q.amountIn;
        assertEq(usdg.balanceOf(maker) - makerUsdBefore, q.amountIn - rfqFee);
        assertEq(usdg.balanceOf(address(d.feeCollector)) - collectorBefore, rfqFee + protocolFee);
    }

    function test_TakerSells_makerPaysRfqFeeOnTop() public {
        (RfqQuote memory q,, SwapParams memory p) = _sellQuote(8);
        uint256 makerUsdBefore = usdg.balanceOf(maker);
        uint256 out = _swap(p);
        assertEq(out, 36_400e6 - 36_400e6 * 2 / 10_000, "protocol fee on the USDG output");
        assertEq(makerUsdBefore - usdg.balanceOf(maker), q.amountOut + q.amountOut * 2 / 10_000);
        assertEq(nvda.balanceOf(address(d.rfq)), 0);
        assertEq(usdg.balanceOf(address(d.rfq)), 0);
    }

    function test_RevertWhen_Replayed() public {
        (,, SwapParams memory p) = _sellQuote(9);
        _swap(p);
        _swapReverts(p, abi.encodeWithSelector(NonceUsed.selector));
    }

    function test_RevertWhen_QuoteForAnotherTaker() public {
        RfqQuote memory q = _quote(false, 200e18, 36_400e6, 10);
        q.taker = lp;
        SwapParams memory p = _params(q, _signQuote(q), q.amountIn);
        _swapReverts(p, abi.encodeWithSelector(WrongTaker.selector));
    }

    function test_RevertWhen_Expired() public {
        (RfqQuote memory q,, SwapParams memory p) = _sellQuote(11);
        vm.warp(q.expiry + 1);
        _refreshFeeds();
        p.deadline = block.timestamp + 60;
        _swapReverts(p, abi.encodeWithSelector(QuoteExpired.selector));
    }

    function test_RevertWhen_SignedByNonMaker() public {
        RfqQuote memory q = _quote(false, 200e18, 36_400e6, 12);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, d.rfq.hashQuote(q));
        SwapParams memory p = _params(q, abi.encodePacked(r, s, v), q.amountIn);
        _swapReverts(p, abi.encodeWithSelector(BadSignature.selector));
    }

    function test_RevertWhen_BelowRfqMinimum() public {
        RfqQuote memory q = _quote(false, 100e18, 18_200e6, 13); // < 25k USDG
        SwapParams memory p = _params(q, _signQuote(q), q.amountIn);
        _swapReverts(p, abi.encodeWithSelector(RfqSizeOutOfRange.selector, uint256(18_200e18)));
    }

    function test_RevertWhen_TamperedAmount() public {
        RfqQuote memory q = _quote(false, 200e18, 36_400e6, 14);
        bytes memory sig = _signQuote(q);
        q.amountOut = 40_000e6;
        SwapParams memory p = _params(q, sig, q.amountIn);
        _swapReverts(p, abi.encodeWithSelector(BadSignature.selector));
    }

    function test_RevertWhen_QuoteDoesNotMatchLeg() public {
        (,, SwapParams memory p) = _sellQuote(15);
        p.amountIn = 150e18;
        p.legs[0].amountIn = 150e18;
        _swapReverts(p, abi.encodeWithSelector(QuoteMismatch.selector));
    }

    function test_MakerCanCancel() public {
        (,, SwapParams memory p) = _sellQuote(16);
        uint256[] memory n = new uint256[](1);
        n[0] = 16;
        vm.prank(maker);
        d.rfq.cancelNonces(n);
        _swapReverts(p, abi.encodeWithSelector(NonceUsed.selector));
    }

    function test_GuardianRemovesMaker() public {
        (,, SwapParams memory p) = _sellQuote(17);
        vm.prank(guardian);
        d.rfq.removeMaker(maker);
        _swapReverts(p, abi.encodeWithSelector(NotMaker.selector));
    }

    function test_RevertWhen_CalledDirectly() public {
        (RfqQuote memory q, bytes memory sig,) = _sellQuote(18);
        vm.expectRevert(NotRouter.selector);
        d.rfq.fill(q, sig, trader, trader);
    }
}
