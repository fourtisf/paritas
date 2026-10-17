// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {DeployCore} from "./DeployCore.sol";
import {Session} from "../src/libraries/Types.sol";
import {AnchorVault} from "../src/AnchorVault.sol";
import {MockERC20, MockStockToken, MockAggregator, MockV3SwapRouter} from "../src/mocks/Mocks.sol";

/// @notice A complete local Paritas on anvil, with the prototype's markets and prices, so the web app and
/// the API can be built against real contracts before mainnet addresses are known.
///
///   anvil --timestamp 1792504800          # Tue 2026-10-20 10:00 New York: vaults open
///   forge script script/DeployLocal.s.sol --rpc-url local --broadcast
///
/// Writes deployments/31337.json in the same shape as 4663.json. Uses anvil's public test keys:
///   #0 deployer / multisig / guardian / attester, #1 demo trader, #2 RFQ maker.
contract DeployLocal is Script, DeployCore {
    uint256 internal constant ANVIL0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant ANVIL1 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant ANVIL2 = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    struct Local {
        MockERC20 usdg;
        MockV3SwapRouter uni;
        MockStockToken[] tokens;
        MockAggregator[] feeds;
        StockCfg[] stocks;
        Deployed d;
    }

    function run() external {
        require(block.chainid == 31337, "local anvil only");
        string memory cfg = _configJson();
        string memory demo = vm.readFile(string.concat(vm.projectRoot(), "/../config/local-demo.json"));
        address deployer = vm.addr(ANVIL0);
        address trader = vm.addr(ANVIL1);
        address maker = vm.addr(ANVIL2);

        Local memory l;
        uint256 n;
        while (vm.keyExistsJson(cfg, string.concat(".markets[", vm.toString(n), "]"))) n++;
        l.tokens = new MockStockToken[](n);
        l.feeds = new MockAggregator[](n);
        l.stocks = new StockCfg[](n);

        vm.startBroadcast(ANVIL0);
        l.usdg = new MockERC20("Global Dollar (local mock)", "USDG", 6);
        l.uni = new MockV3SwapRouter();
        for (uint256 i; i < n; ++i) {
            string memory m = string.concat(".markets[", vm.toString(i), "].");
            string memory sym = vm.parseJsonString(cfg, string.concat(m, "symbol"));
            l.tokens[i] = new MockStockToken(vm.parseJsonString(cfg, string.concat(m, "name")), sym);
            l.feeds[i] = new MockAggregator(8, int256(vm.parseJsonUint(demo, string.concat(".markets.", sym, ".price8"))));
            l.stocks[i] = StockCfg({
                symbol: sym,
                token: address(l.tokens[i]),
                feed: address(l.feeds[i]),
                tier: tierIndex(cfg, vm.parseJsonString(cfg, string.concat(m, "tier"))),
                useMultiplier: false,
                checkOraclePaused: true,
                createVault: vm.parseJsonUint(cfg, string.concat(m, "wave")) == 1
            });
        }
        l.d = _deployCore(
            deployer, Roles(deployer, deployer, deployer, maker), External(address(l.usdg), address(l.uni), address(0)),
            l.stocks, false, 0
        );
        _seed(l, cfg, demo, deployer, trader, maker);
        vm.stopBroadcast();

        vm.startBroadcast(ANVIL2);
        l.usdg.approve(address(l.d.rfq), type(uint256).max);
        for (uint256 i; i < n; ++i) {
            l.tokens[i].approve(address(l.d.rfq), type(uint256).max);
        }
        vm.stopBroadcast();

        _write(l, deployer, trader, maker);
    }

    function _seed(Local memory l, string memory cfg, string memory demo, address lp, address trader, address maker)
        internal
    {
        l.usdg.mint(address(l.uni), 100_000_000e6);
        l.usdg.mint(trader, 250_000e6);
        l.usdg.mint(maker, 20_000_000e6);
        bool open = l.d.sessions.current() != Session.Closed;
        if (!open) console2.log("Session is Closed at this block time: vaults NOT seeded. Restart anvil with --timestamp 1792504800");
        for (uint256 i; i < l.stocks.length; ++i) {
            string memory sym = l.stocks[i].symbol;
            uint256 price8 = vm.parseJsonUint(demo, string.concat(".markets.", sym, ".price8"));
            string memory tierKey = vm.parseJsonString(cfg, string.concat(".markets[", vm.toString(i), "].tier"));
            uint256 cost = vm.parseJsonUint(demo, string.concat(".uniswapCostBps.", tierKey));
            MockStockToken t = l.tokens[i];
            t.mint(address(l.uni), 1_000_000e18);
            t.mint(trader, 100e18);
            t.mint(maker, 50_000e18);
            l.uni.setRate(address(l.usdg), address(t), uint256(1e18) * 1e12 * 1e8 / price8 * (10_000 - cost) / 10_000);
            l.uni.setRate(address(t), address(l.usdg), price8 * 1e6 / 1e8 * (10_000 - cost) / 10_000);

            uint256 tvl = vm.parseJsonUint(demo, string.concat(".markets.", sym, ".seedTvlUsd"));
            if (!open || tvl == 0 || !l.stocks[i].createVault) continue;
            uint256 share = vm.parseJsonUint(demo, string.concat(".markets.", sym, ".tokenShareBps"));
            uint256 stockUsd = tvl * share / 10_000;
            uint256 stockAmt = stockUsd * 1e18 * 1e8 / price8;
            uint256 usdAmt = (tvl - stockUsd) * 1e6;
            AnchorVault v = AnchorVault(l.d.factory.vaultOf(address(t)));
            t.mint(lp, stockAmt);
            l.usdg.mint(lp, usdAmt);
            t.approve(address(v), stockAmt);
            l.usdg.approve(address(v), usdAmt);
            v.deposit(usdAmt, stockAmt, 0, lp);
        }
    }

    function _write(Local memory l, address deployer, address trader, address maker) internal {
        string memory path = string.concat(vm.projectRoot(), "/../deployments/31337.json");
        string memory stocksJson;
        string memory vaultsJson;
        for (uint256 i; i < l.stocks.length; ++i) {
            string memory sk = string.concat("stock_", l.stocks[i].symbol);
            vm.serializeAddress(sk, "token", l.stocks[i].token);
            string memory one = vm.serializeAddress(sk, "chainlinkFeed", l.stocks[i].feed);
            stocksJson = vm.serializeString("stocks", l.stocks[i].symbol, one);
            vaultsJson = vm.serializeAddress("vaults", l.stocks[i].symbol, l.d.factory.vaultOf(l.stocks[i].token));
        }
        string memory usdgJson = vm.serializeAddress("usdgObj", "address", address(l.usdg));
        string memory uniJson = vm.serializeAddress("uniObj", "address", address(l.uni));
        string memory seqJson = vm.serializeAddress("seqObj", "address", address(0));
        vm.serializeString("external", "usdg", usdgJson);
        vm.serializeString("external", "uniswapV3SwapRouter02", uniJson);
        vm.serializeString("external", "sequencerUptimeFeed", seqJson);
        string memory extJson = vm.serializeString("external", "stocks", stocksJson);

        vm.serializeAddress("roles", "multisig", deployer);
        vm.serializeAddress("roles", "guardian", deployer);
        vm.serializeAddress("roles", "attester", deployer);
        vm.serializeAddress("roles", "demoTrader", trader);
        string memory rolesJson = vm.serializeAddress("roles", "rfqMaker", maker);

        string memory k = "paritas";
        vm.serializeAddress(k, "timelock", address(l.d.timelock));
        vm.serializeAddress(k, "paramController", address(l.d.params));
        vm.serializeAddress(k, "sessionController", address(l.d.sessions));
        vm.serializeAddress(k, "oracleRouter", address(l.d.oracle));
        vm.serializeAddress(k, "eligibilityRegistry", address(l.d.eligibility));
        vm.serializeAddress(k, "feeCollector", address(l.d.feeCollector));
        vm.serializeAddress(k, "vaultFactory", address(l.d.factory));
        vm.serializeAddress(k, "swapRouter", address(l.d.router));
        vm.serializeAddress(k, "rfqSettlement", address(l.d.rfq));
        vm.serializeAddress(k, "uniswapV3Adapter", address(l.d.uniswapAdapter));
        vm.serializeUint(k, "deployedAtBlock", block.number);
        string memory pj = vm.serializeString(k, "vaults", vaultsJson);

        string memory root = "root";
        vm.serializeString(root, "_comment", "Local anvil deployment written by DeployLocal.s.sol. Mocks only.");
        vm.serializeUint(root, "chainId", 31337);
        vm.serializeString(root, "rpc", "http://127.0.0.1:8545");
        vm.serializeString(root, "external", extJson);
        vm.serializeString(root, "roles", rolesJson);
        string memory out = vm.serializeString(root, "paritas", pj);
        vm.writeJson(out, path);
        console2.log("Wrote", path);
    }
}
