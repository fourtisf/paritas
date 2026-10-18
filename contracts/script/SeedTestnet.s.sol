// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Session} from "../src/libraries/Types.sol";
import {AnchorVault} from "../src/AnchorVault.sol";
import {SessionController} from "../src/SessionController.sol";
import {MockERC20, MockAggregator} from "../src/mocks/Mocks.sol";

/// @notice Seeds the empty testnet vaults written by DeployTestnet.s.sol with minted test assets, at each feed's
/// current price (run the keeper first so the feeds carry live reference prices). Deposits need an open New York
/// session, so run it on a trading day. Skips any vault that already has shares; safe to run again.
///
///   forge script script/SeedTestnet.s.sol --rpc-url robinhood_testnet --account paritas-testnet --sender <address> --broadcast
contract SeedTestnet is Script {
    function run() external {
        require(block.chainid == 46630, "SeedTestnet: Robinhood Chain testnet (46630) only");
        string memory root = vm.projectRoot();
        string memory dep = vm.readFile(string.concat(root, "/../deployments/46630.json"));
        require(vm.parseJsonBool(dep, ".mocks"), "SeedTestnet: deployments/46630.json is not a DeployTestnet deployment");
        string memory demo = vm.readFile(string.concat(root, "/../config/local-demo.json"));
        string memory cfg = vm.readFile(string.concat(root, "/../config/protocol.json"));
        SessionController sessions = SessionController(vm.parseJsonAddress(dep, ".paritas.sessionController"));
        require(sessions.current() != Session.Closed, "SeedTestnet: the session is Closed now; run it while the vault is open");
        MockERC20 usdg = MockERC20(vm.parseJsonAddress(dep, ".external.usdg.address"));
        address lp = msg.sender;

        vm.startBroadcast();
        for (uint256 i; vm.keyExistsJson(cfg, string.concat(".markets[", vm.toString(i), "]")); ++i) {
            string memory sym = vm.parseJsonString(cfg, string.concat(".markets[", vm.toString(i), "].symbol"));
            if (!vm.keyExistsJson(dep, string.concat(".paritas.vaults.", sym))) continue;
            address vaultAddr = vm.parseJsonAddress(dep, string.concat(".paritas.vaults.", sym));
            uint256 tvl = vm.parseJsonUint(demo, string.concat(".markets.", sym, ".seedTvlUsd"));
            if (vaultAddr == address(0) || tvl == 0) continue;
            AnchorVault v = AnchorVault(vaultAddr);
            if (v.totalSupply() > 0) {
                console2.log("already seeded", sym);
                continue;
            }
            MockERC20 tok = MockERC20(vm.parseJsonAddress(dep, string.concat(".external.stocks.", sym, ".token")));
            (, int256 answer,,,) = MockAggregator(vm.parseJsonAddress(dep, string.concat(".external.stocks.", sym, ".chainlinkFeed"))).latestRoundData();
            uint256 price8 = uint256(answer);
            uint256 share = vm.parseJsonUint(demo, string.concat(".markets.", sym, ".tokenShareBps"));
            uint256 stockUsd = tvl * share / 10_000;
            uint256 stockAmt = stockUsd * 1e18 * 1e8 / price8;
            uint256 usdAmt = (tvl - stockUsd) * 1e6;
            tok.mint(lp, stockAmt);
            usdg.mint(lp, usdAmt);
            tok.approve(address(v), stockAmt);
            usdg.approve(address(v), usdAmt);
            v.deposit(usdAmt, stockAmt, 0, lp);
            console2.log("seeded", sym, tvl);
        }
        vm.stopBroadcast();
    }
}
