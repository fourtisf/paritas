// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployCore} from "../script/DeployCore.sol";
import {Venue, Leg, SwapParams, RfqQuote} from "../src/libraries/Types.sol";
import {AnchorVault} from "../src/AnchorVault.sol";
import {MockERC20, MockStockToken, MockAggregator, MockV3SwapRouter} from "../src/mocks/Mocks.sol";

/// @notice Deploys the full protocol with DeployCore (same code as production) on top of mocks.
/// Clock starts on Tuesday 2026-10-20 10:00 New York (Regular session).
abstract contract Base is Test, DeployCore {
    uint256 internal constant REGULAR_TS = 1792504800; // Tue 2026-10-20 10:00 NY
    uint256 internal constant EXTENDED_TS = 1792530000; // Tue 17:00 NY
    uint256 internal constant OVERNIGHT_TS = 1792548000; // Tue 22:00 NY
    uint256 internal constant CLOSED_TS = 1792857600; // Sat 2026-10-24 12:00 NY

    uint256 internal constant NVDA_PRICE = 182_40000000; // 8 decimals, like Chainlink
    uint256 internal constant TSLA_PRICE = 431_80000000;
    uint256 internal constant PLTR_PRICE = 176_25000000;

    uint256 internal attesterPk = 0xA77E57;
    uint256 internal makerPk = 0x3A4E2;

    address internal multisig = makeAddr("multisig");
    address internal guardian = makeAddr("guardian");
    address internal attester;
    address internal maker;
    address internal trader = makeAddr("trader");
    address internal lp = makeAddr("lp");
    address internal outsider = makeAddr("outsider"); // never attested

    MockERC20 internal usdg;
    MockStockToken internal nvda; // tier A, vault
    MockStockToken internal tsla; // tier B, vault
    MockStockToken internal pltr; // tier C, no vault (wave 2)
    MockAggregator internal nvdaFeed;
    MockAggregator internal tslaFeed;
    MockAggregator internal pltrFeed;
    MockAggregator internal seqFeed;
    MockV3SwapRouter internal uni;

    Deployed internal d;
    AnchorVault internal nvdaVault;
    AnchorVault internal tslaVault;
    address internal tl;

    function setUp() public virtual {
        vm.warp(REGULAR_TS);
        attester = vm.addr(attesterPk);
        maker = vm.addr(makerPk);

        usdg = new MockERC20("Global Dollar", "USDG", 6);
        nvda = new MockStockToken("NVIDIA", "NVDAx");
        tsla = new MockStockToken("Tesla", "TSLAx");
        pltr = new MockStockToken("Palantir", "PLTRx");
        nvdaFeed = new MockAggregator(8, int256(NVDA_PRICE));
        tslaFeed = new MockAggregator(8, int256(TSLA_PRICE));
        pltrFeed = new MockAggregator(8, int256(PLTR_PRICE));
        seqFeed = new MockAggregator(0, 0);
        seqFeed.setStatus(0, block.timestamp - 2 days);
        uni = new MockV3SwapRouter();

        StockCfg[] memory stocks = new StockCfg[](3);
        stocks[0] = StockCfg("NVDAx", address(nvda), address(nvdaFeed), 0, false, true, true);
        stocks[1] = StockCfg("TSLAx", address(tsla), address(tslaFeed), 1, false, true, true);
        stocks[2] = StockCfg("PLTRx", address(pltr), address(pltrFeed), 2, false, true, false);

        d = _deployCore(
            address(this),
            Roles(multisig, guardian, attester, maker),
            External(address(usdg), address(uni), address(seqFeed)),
            stocks,
            true,
            2 days
        );
        tl = address(d.timelock);
        nvdaVault = AnchorVault(d.factory.vaultOf(address(nvda)));
        tslaVault = AnchorVault(d.factory.vaultOf(address(tsla)));

        _attest(trader);
        _attest(lp);
        _attest(maker);

        // LP seeds the NVDA vault roughly 50/50 like the prototype (about 1.28M USDG of value)
        _fund(lp, 2_000_000e6, 10_000e18, 2_000e18);
        vm.startPrank(lp);
        usdg.approve(address(nvdaVault), type(uint256).max);
        nvda.approve(address(nvdaVault), type(uint256).max);
        nvdaVault.deposit(640_000e6, 3_509e18, 0, lp);
        usdg.approve(address(tslaVault), type(uint256).max);
        tsla.approve(address(tslaVault), type(uint256).max);
        tslaVault.deposit(98_000e6, 227e18, 0, lp);
        vm.stopPrank();

        // trader wallet + approvals
        _fund(trader, 1_000_000e6, 5_000e18, 500e18);
        vm.startPrank(trader);
        usdg.approve(address(d.router), type(uint256).max);
        nvda.approve(address(d.router), type(uint256).max);
        tsla.approve(address(d.router), type(uint256).max);
        pltr.approve(address(d.router), type(uint256).max);
        vm.stopPrank();

        // maker inventory + approvals to the settlement contract
        _fund(maker, 10_000_000e6, 50_000e18, 0);
        vm.startPrank(maker);
        usdg.approve(address(d.rfq), type(uint256).max);
        nvda.approve(address(d.rfq), type(uint256).max);
        vm.stopPrank();

        // mock Uniswap: 15 bps worse than oracle in both directions, plenty of inventory
        usdg.mint(address(uni), 50_000_000e6);
        nvda.mint(address(uni), 200_000e18);
        pltr.mint(address(uni), 200_000e18);
        _setUniCost(nvda, NVDA_PRICE, 15);
        _setUniCost(pltr, PLTR_PRICE, 15);
    }

    // ---------------------------------------------------------------- helpers

    function _fund(address who, uint256 u, uint256 n, uint256 t) internal {
        usdg.mint(who, u);
        nvda.mint(who, n);
        tsla.mint(who, t);
        pltr.mint(who, n);
    }

    function _attest(address who) internal {
        uint64 until = uint64(block.timestamp + 90 days);
        uint64 issuedAt = uint64(block.timestamp);
        bytes32 digest = d.eligibility.attestationDigest(who, until, issuedAt);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterPk, digest);
        d.eligibility.attest(who, until, issuedAt, abi.encodePacked(r, s, v));
    }

    /// @dev cost in bps versus a price with 8 decimals; stock has 18 decimals, USDG 6
    function _setUniCost(MockStockToken stock, uint256 price8, uint256 costBps) internal {
        // USDG -> stock: tokens per 1e18 raw USDG = 1e18 * 1e12 / price * (1 - cost)
        uint256 buyRate = uint256(1e18) * 1e12 * 1e8 / price8 * (10_000 - costBps) / 10_000;
        // stock -> USDG: raw USDG per 1e18 raw stock = price * 1e6 / 1e8 * (1 - cost)
        uint256 sellRate = price8 * 1e6 / 1e8 * (10_000 - costBps) / 10_000;
        uni.setRate(address(usdg), address(stock), buyRate);
        uni.setRate(address(stock), address(usdg), sellRate);
    }

    function _net(uint256 amountIn) internal view returns (uint256) {
        return amountIn - amountIn * d.params.protocolFeeBps() / 10_000;
    }

    function _oneLeg(address stock, bool buy, uint256 amountIn, Venue v, bytes memory data)
        internal
        view
        returns (SwapParams memory p)
    {
        p.stock = stock;
        p.buy = buy;
        p.amountIn = amountIn;
        p.minAmountOut = 0;
        p.recipient = trader;
        p.deadline = block.timestamp + 20 minutes;
        p.legs = new Leg[](1);
        p.legs[0] = Leg(v, buy ? _net(amountIn) : amountIn, data);
    }

    function _swap(SwapParams memory p) internal returns (uint256) {
        vm.prank(trader);
        return d.router.swap(p);
    }

    /// @dev Build params BEFORE calling this: vm.prank / vm.expectRevert apply to the next external
    /// call, and building params makes view calls that would consume them.
    function _swapReverts(SwapParams memory p, bytes memory err) internal {
        vm.prank(trader);
        if (err.length == 0) vm.expectRevert();
        else vm.expectRevert(err);
        d.router.swap(p);
    }

    function _signQuote(RfqQuote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerPk, d.rfq.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    function _quote(bool takerBuys, uint256 amountIn, uint256 amountOut, uint256 nonce)
        internal
        view
        returns (RfqQuote memory q)
    {
        q = RfqQuote(maker, trader, address(nvda), takerBuys, amountIn, amountOut, nonce, block.timestamp + 30);
    }

    /// @dev timelock round trip: schedule as the multisig, wait the delay, execute
    function _govern(address target, bytes memory data) internal {
        bytes32 salt = keccak256(abi.encode(target, data, block.timestamp));
        vm.prank(multisig);
        d.timelock.schedule(target, 0, data, bytes32(0), salt, 2 days);
        vm.warp(block.timestamp + 2 days);
        vm.prank(multisig);
        d.timelock.execute(target, 0, data, bytes32(0), salt);
    }

    /// @dev keep the oracle fresh after moving the clock
    function _refreshFeeds() internal {
        nvdaFeed.set(int256(NVDA_PRICE), block.timestamp);
        tslaFeed.set(int256(TSLA_PRICE), block.timestamp);
        pltrFeed.set(int256(PLTR_PRICE), block.timestamp);
    }
}
