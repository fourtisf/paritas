// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {DeployCore} from "./DeployCore.sol";
import {MockERC20, MockStockToken, MockAggregator, MockV3SwapRouter} from "../src/mocks/Mocks.sol";

/// @notice Paritas on Robinhood Chain testnet (46630) with its own test assets, so the app can be used in public
/// before the real testnet assets are checked on Blockscout. It deploys mock USDG, one mock stock token and one
/// Chainlink-style feed per market, and a fixed-rate stand-in for the Uniswap router. Anyone can mint the test
/// tokens (the app's faucet does), and the feeds are moved to live reference prices by the keeper
/// (packages/shared/scripts/keeper-testnet.ts). Refuses every other chain; mainnet only ever uses Deploy.s.sol.
///
///   forge script script/DeployTestnet.s.sol --rpc-url robinhood_testnet --account paritas-testnet --sender <address> --broadcast
///
/// The deployer is multisig, guardian, attester and keeper. Eligibility is not enforced. Vaults are created empty:
/// start the keeper, then seed them with SeedTestnet.s.sol while the New York session is open.
/// Writes deployments/46630.json (with "mocks": true), keeping the template's rpc and explorer.
contract DeployTestnet is Script, DeployCore {
    struct T {
        MockERC20 usdg;
        MockV3SwapRouter uni;
        StockCfg[] stocks;
        Deployed d;
    }

    function run() external {
        require(block.chainid == 46630, "DeployTestnet: Robinhood Chain testnet (46630) only");
        string memory cfg = _configJson();
        string memory demo = vm.readFile(string.concat(vm.projectRoot(), "/../config/local-demo.json"));
        address deployer = msg.sender;
        require(deployer != address(0) && deployer.balance > 0, "DeployTestnet: pass --account and --sender of a funded testnet wallet");

        T memory t;
        uint256 n;
        while (vm.keyExistsJson(cfg, string.concat(".markets[", vm.toString(n), "]"))) n++;
        t.stocks = new StockCfg[](n);

        vm.startBroadcast();
        t.usdg = new MockERC20("Global Dollar (testnet mock)", "USDG", 6);
        t.uni = new MockV3SwapRouter();
        for (uint256 i; i < n; ++i) {
            string memory m = string.concat(".markets[", vm.toString(i), "].");
            string memory sym = vm.parseJsonString(cfg, string.concat(m, "symbol"));
            uint256 price8 = vm.parseJsonUint(demo, string.concat(".markets.", sym, ".price8"));
            MockStockToken tok = new MockStockToken(string.concat(vm.parseJsonString(cfg, string.concat(m, "name")), " (testnet mock)"), sym);
            MockAggregator feed = new MockAggregator(8, int256(price8));
            t.stocks[i] = StockCfg({
                symbol: sym,
                token: address(tok),
                feed: address(feed),
                tier: tierIndex(cfg, vm.parseJsonString(cfg, string.concat(m, "tier"))),
                useMultiplier: false,
                checkOraclePaused: true,
                createVault: vm.parseJsonUint(cfg, string.concat(m, "wave")) == 1
            });
            // the Uniswap stand-in fills from its own balance at the share price less the tier's pool cost
            uint256 cost = vm.parseJsonUint(demo, string.concat(".uniswapCostBps.", vm.parseJsonString(cfg, string.concat(m, "tier"))));
            tok.mint(address(t.uni), 1_000_000e18);
            t.uni.setRate(address(t.usdg), address(tok), uint256(1e18) * 1e12 * 1e8 / price8 * (10_000 - cost) / 10_000);
            t.uni.setRate(address(tok), address(t.usdg), price8 * 1e6 / 1e8 * (10_000 - cost) / 10_000);
        }
        t.usdg.mint(address(t.uni), 100_000_000e6);
        t.d = _deployCore(
            deployer,
            Roles(deployer, deployer, deployer, address(0)),
            External(address(t.usdg), address(t.uni), address(0)),
            t.stocks,
            false,
            vm.parseJsonUint(cfg, ".governance.timelockDelaySec")
        );
        vm.stopBroadcast();

        _write(t, deployer);
        console2.log("Next: start the keeper, then seed the vaults with SeedTestnet.s.sol while the session is open.");
    }

    function _write(T memory t, address deployer) internal {
        string memory path = string.concat(vm.projectRoot(), "/../deployments/46630.json");
        string memory tpl = vm.readFile(path);
        string memory stocksJson;
        string memory vaultsJson;
        for (uint256 i; i < t.stocks.length; ++i) {
            string memory sk = string.concat("stock_", t.stocks[i].symbol);
            vm.serializeAddress(sk, "token", t.stocks[i].token);
            string memory one = vm.serializeAddress(sk, "chainlinkFeed", t.stocks[i].feed);
            stocksJson = vm.serializeString("stocks", t.stocks[i].symbol, one);
            vaultsJson = vm.serializeAddress("vaults", t.stocks[i].symbol, t.d.factory.vaultOf(t.stocks[i].token));
        }
        vm.serializeString("external", "usdg", vm.serializeAddress("usdgObj", "address", address(t.usdg)));
        vm.serializeString("external", "uniswapV3SwapRouter02", vm.serializeAddress("uniObj", "address", address(t.uni)));
        vm.serializeString("external", "sequencerUptimeFeed", vm.serializeAddress("seqObj", "address", address(0)));
        string memory extJson = vm.serializeString("external", "stocks", stocksJson);

        vm.serializeAddress("roles", "multisig", deployer);
        vm.serializeAddress("roles", "guardian", deployer);
        vm.serializeAddress("roles", "attester", deployer);
        string memory rolesJson = vm.serializeAddress("roles", "keeper", deployer);

        string memory k = "paritas";
        vm.serializeAddress(k, "timelock", address(t.d.timelock));
        vm.serializeAddress(k, "paramController", address(t.d.params));
        vm.serializeAddress(k, "sessionController", address(t.d.sessions));
        vm.serializeAddress(k, "oracleRouter", address(t.d.oracle));
        vm.serializeAddress(k, "eligibilityRegistry", address(t.d.eligibility));
        vm.serializeAddress(k, "feeCollector", address(t.d.feeCollector));
        vm.serializeAddress(k, "vaultFactory", address(t.d.factory));
        vm.serializeAddress(k, "swapRouter", address(t.d.router));
        vm.serializeAddress(k, "rfqSettlement", address(t.d.rfq));
        vm.serializeAddress(k, "uniswapV3Adapter", address(t.d.uniswapAdapter));
        vm.serializeUint(k, "deployedAtBlock", block.number);
        string memory pj = vm.serializeString(k, "vaults", vaultsJson);

        string memory root = "root";
        vm.serializeString(
            root,
            "_comment",
            "Robinhood Chain testnet with test assets, written by DeployTestnet.s.sol: mock USDG, stock tokens, feeds and Uniswap stand-in. Not the real testnet assets. git checkout this file to get the Blockscout template back."
        );
        vm.serializeUint(root, "chainId", 46630);
        vm.serializeBool(root, "mocks", true);
        vm.serializeString(root, "rpc", vm.parseJsonString(tpl, ".rpc"));
        vm.serializeString(root, "explorer", vm.parseJsonString(tpl, ".explorer"));
        vm.serializeString(root, "external", extJson);
        vm.serializeString(root, "roles", rolesJson);
        string memory out = vm.serializeString(root, "paritas", pj);
        vm.writeJson(out, path);
        console2.log("Wrote", path);
    }
}
