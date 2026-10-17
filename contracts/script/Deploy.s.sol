// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DeployCore} from "./DeployCore.sol";
import {AggregatorV3Interface} from "../src/interfaces/External.sol";

/// @notice Testnet (46630) and mainnet (4663) deployment.
///
///   1. Fill deployments/<chainId>.json. Every address must be opened on Blockscout and checked by a human.
///   2. Dry run (no broadcast):  forge script script/Deploy.s.sol --rpc-url robinhood --sender <deployer>
///   3. Read the printed checks. Then add: --broadcast --verify --account <keystore name>
///
/// The script refuses to run while any TODO, zero or non-contract address remains, and prints what it
/// read from each token and feed so a reviewer can compare against Blockscout before broadcasting.
contract Deploy is Script, DeployCore {
    string internal constant TODO = "TODO";

    function run() external {
        require(block.chainid == 4663 || block.chainid == 46630, "use DeployLocal.s.sol for local chains");
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        string memory j = vm.readFile(path);
        string memory cfg = _configJson();

        External memory ext = External({
            usdg: _contractAt(j, ".external.usdg.address"),
            swapRouter02: _contractAt(j, ".external.uniswapV3SwapRouter02.address"),
            sequencerFeed: _optionalContractAt(j, ".external.sequencerUptimeFeed.address")
        });
        Roles memory roles = Roles({
            // mainnet: must be the Safe (a contract). testnet: an EOA is fine for rehearsals
            multisig: block.chainid == 4663 ? _contractAt(j, ".roles.multisig") : _addr(j, ".roles.multisig"),
            guardian: _addr(j, ".roles.guardian"),
            attester: _addr(j, ".roles.attester"),
            rfqMaker: address(0) // makers are added later through the timelock
        });

        StockCfg[] memory stocks = _stocks(j, cfg);
        _printChecks(ext, stocks);

        bool enforce = block.chainid == 4663
            ? vm.parseJsonBool(cfg, ".eligibility.enforcedOnMainnet")
            : vm.envOr("ENFORCE_ELIGIBILITY", false);
        require(block.chainid != 4663 || enforce, "eligibility must be enforced on mainnet");
        uint256 delay = vm.parseJsonUint(cfg, ".governance.timelockDelaySec");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        Deployed memory d = _deployCore(deployer, roles, ext, stocks, enforce, delay);
        vm.stopBroadcast();

        _write(path, d, stocks);
    }

    // ---------------------------------------------------------------- config reading

    function _stocks(string memory j, string memory cfg) internal view returns (StockCfg[] memory out) {
        uint256 n;
        while (vm.keyExistsJson(cfg, string.concat(".markets[", vm.toString(n), "]"))) n++;
        out = new StockCfg[](n);
        for (uint256 i; i < n; ++i) {
            string memory m = string.concat(".markets[", vm.toString(i), "].");
            string memory sym = vm.parseJsonString(cfg, string.concat(m, "symbol"));
            string memory s = string.concat(".external.stocks.", sym, ".");
            out[i] = StockCfg({
                symbol: sym,
                token: _contractAt(j, string.concat(s, "token")),
                feed: _contractAt(j, string.concat(s, "chainlinkFeed")),
                tier: tierIndex(cfg, vm.parseJsonString(cfg, string.concat(m, "tier"))),
                useMultiplier: vm.parseJsonBool(j, string.concat(s, "useUiMultiplier")),
                checkOraclePaused: vm.parseJsonBool(j, string.concat(s, "checkOraclePaused")),
                createVault: vm.parseJsonUint(cfg, string.concat(m, "wave")) == 1
            });
        }
    }

    function _addr(string memory j, string memory key) internal pure returns (address a) {
        string memory raw = vm.parseJsonString(j, key);
        require(!_startsWith(raw, TODO), string.concat(key, " is still TODO"));
        a = vm.parseAddress(raw);
        require(a != address(0), string.concat(key, " is zero"));
    }

    function _contractAt(string memory j, string memory key) internal view returns (address a) {
        a = _addr(j, key);
        require(a.code.length > 0, string.concat(key, " has no code on this chain"));
    }

    function _optionalContractAt(string memory j, string memory key) internal view returns (address a) {
        string memory raw = vm.parseJsonString(j, key);
        require(!_startsWith(raw, TODO), string.concat(key, " is still TODO (set 0x000...000 to disable on purpose)"));
        a = vm.parseAddress(raw);
        if (a != address(0)) require(a.code.length > 0, string.concat(key, " has no code on this chain"));
    }

    function _startsWith(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (a.length < b.length) return false;
        for (uint256 i; i < b.length; ++i) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function _printChecks(External memory ext, StockCfg[] memory stocks) internal view {
        console2.log("== Compare every line with Blockscout before broadcasting ==");
        console2.log("USDG", ext.usdg, IERC20Metadata(ext.usdg).symbol(), IERC20Metadata(ext.usdg).decimals());
        console2.log("Uniswap SwapRouter02", ext.swapRouter02);
        console2.log("Sequencer uptime feed", ext.sequencerFeed);
        for (uint256 i; i < stocks.length; ++i) {
            StockCfg memory s = stocks[i];
            (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(s.feed).latestRoundData();
            console2.log(s.symbol, s.token, IERC20Metadata(s.token).symbol(), IERC20Metadata(s.token).decimals());
            console2.log("  feed", s.feed, AggregatorV3Interface(s.feed).decimals());
            console2.log("  answer / age (s)", uint256(answer), block.timestamp - updatedAt);
            console2.log("  tier / vault now", s.tier, s.createVault);
        }
    }

    function _write(string memory path, Deployed memory d, StockCfg[] memory stocks) internal {
        string memory k = "paritas";
        vm.serializeAddress(k, "timelock", address(d.timelock));
        vm.serializeAddress(k, "paramController", address(d.params));
        vm.serializeAddress(k, "sessionController", address(d.sessions));
        vm.serializeAddress(k, "oracleRouter", address(d.oracle));
        vm.serializeAddress(k, "eligibilityRegistry", address(d.eligibility));
        vm.serializeAddress(k, "feeCollector", address(d.feeCollector));
        vm.serializeAddress(k, "vaultFactory", address(d.factory));
        vm.serializeAddress(k, "swapRouter", address(d.router));
        vm.serializeAddress(k, "rfqSettlement", address(d.rfq));
        vm.serializeAddress(k, "uniswapV3Adapter", address(d.uniswapAdapter));
        vm.serializeUint(k, "deployedAtBlock", block.number);
        string memory vaults = "vaults";
        string memory vj = "{}";
        for (uint256 i; i < stocks.length; ++i) {
            vj = vm.serializeAddress(vaults, stocks[i].symbol, d.factory.vaultOf(stocks[i].token));
        }
        string memory out = vm.serializeString(k, "vaults", vj);
        vm.writeJson(out, path, ".paritas");
        console2.log("Wrote", path);
    }
}
