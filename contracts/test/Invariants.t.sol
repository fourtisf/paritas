// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {Venue, SwapParams} from "../src/libraries/Types.sol";
import {VaultMath} from "../src/libraries/VaultMath.sol";

/// @notice Property tests for the guarantees listed in docs/BRIEF.md section 4.
contract InvariantsTest is Base {
    /// The vault never trades through the oracle price, whatever the inventory, size or session.
    function testFuzz_VaultNeverTradesThroughOracle(
        uint256 price,
        uint256 rs,
        uint256 ru,
        uint256 amount,
        uint8 tier,
        uint8 sess,
        bool buy
    ) public pure {
        price = bound(price, 1e18, 10_000e18);
        rs = bound(rs, 0, 1e30);
        ru = bound(ru, 0, 1e15);
        amount = bound(amount, 1, buy ? 1e13 : 1e26);
        uint256[3] memory hs = [uint256(10), 20, 40];
        uint256[3] memory sk = [uint256(15), 25, 50];
        uint256[3] memory mul = [uint256(10_000), 15_000, 20_000];
        VaultMath.Pool memory p = VaultMath.Pool(price, rs, ru, 1e18, 1e12);
        VaultMath.Pricing memory q = VaultMath.Pricing(hs[tier % 3], sk[tier % 3], mul[sess % 3], 1000);
        VaultMath.Result memory r = VaultMath.quote(p, q, buy, amount);
        if (buy) {
            // value of tokens out at oracle <= USDG in
            assertLe(r.amountOut * price / 1e18, amount * 1e12);
        } else {
            // USDG out <= value of tokens in at oracle
            assertLe(r.amountOut * 1e12, amount * price / 1e18);
        }
        assertLe(r.spreadShare * 1e12, r.notionalWad / 10, "spread share is a slice of the spread");
    }

    /// The router never keeps tokens, and the trader always gets at least minAmountOut.
    function testFuzz_RouterKeepsNothing(uint256 usdIn, uint256 stockIn, bool buy, bool viaUniswap) public {
        usdIn = bound(usdIn, 1e6, 45_000e6);
        stockIn = bound(stockIn, 1e15, 240e18);
        uint256 amountIn = buy ? usdIn : stockIn;
        SwapParams memory p = viaUniswap
            ? _oneLeg(address(nvda), buy, amountIn, Venue.Uniswap, abi.encode(uint24(500)))
            : _oneLeg(address(nvda), buy, amountIn, Venue.Vault, "");
        uint256 out = _swap(p);
        assertGt(out, 0);
        assertEq(usdg.balanceOf(address(d.router)), 0);
        assertEq(nvda.balanceOf(address(d.router)), 0);
        assertEq(usdg.balanceOf(address(d.uniswapAdapter)), 0);
        assertEq(nvda.balanceOf(address(d.uniswapAdapter)), 0);
    }

    /// At a constant oracle price, trading never lowers the value of an LP share.
    function testFuzz_SwapsNeverLowerNavPerShare(uint256[6] memory sizes, uint256 sides) public {
        uint256 supply = nvdaVault.totalSupply();
        uint256 nav0 = nvdaVault.navWad();
        for (uint256 i; i < sizes.length; ++i) {
            bool buy = (sides >> i) & 1 == 1;
            uint256 amt = buy ? bound(sizes[i], 1e6, 40_000e6) : bound(sizes[i], 1e15, 200e18);
            _swap(_oneLeg(address(nvda), buy, amt, Venue.Vault, ""));
        }
        assertEq(nvdaVault.totalSupply(), supply);
        assertGe(nvdaVault.navWad(), nav0);
    }

    /// Reserves always match balances after swaps (no tokens created or lost inside the vault).
    function testFuzz_ReservesMatchBalances(uint256 a, uint256 b) public {
        _swap(_oneLeg(address(nvda), true, bound(a, 1e6, 40_000e6), Venue.Vault, ""));
        _swap(_oneLeg(address(nvda), false, bound(b, 1e15, 200e18), Venue.Vault, ""));
        assertEq(usdg.balanceOf(address(nvdaVault)), nvdaVault.reserveUsd());
        assertEq(nvda.balanceOf(address(nvdaVault)), nvdaVault.reserveStock());
    }
}
