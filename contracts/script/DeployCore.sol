// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {CommonBase} from "forge-std/Base.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Session, Venue, TierParams, SessionParams} from "../src/libraries/Types.sol";
import {ParamController} from "../src/ParamController.sol";
import {SessionController} from "../src/SessionController.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {EligibilityRegistry} from "../src/EligibilityRegistry.sol";
import {FeeCollector} from "../src/FeeCollector.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {SwapRouter} from "../src/SwapRouter.sol";
import {RfqSettlement} from "../src/RfqSettlement.sol";
import {UniswapV3Adapter} from "../src/adapters/UniswapV3Adapter.sol";

/// @notice One deployment routine shared by Deploy.s.sol (testnet/mainnet), DeployLocal.s.sol (anvil)
/// and every test (test/Base.t.sol), so the tests exercise exactly what ships.
/// Parameters come from config/protocol.json, holidays from config/holidays.json.
abstract contract DeployCore is CommonBase {
    struct Roles {
        address multisig; // timelock proposer + executor (Safe 3-of-5 on mainnet)
        address guardian; // pause-only
        address attester; // eligibility attestation signer (KYC provider key)
        address rfqMaker; // optional first allowlisted maker; zero = none (add later via timelock)
    }

    struct External {
        address usdg;
        address swapRouter02;
        address sequencerFeed; // zero disables the check
    }

    struct StockCfg {
        string symbol;
        address token;
        address feed;
        uint8 tier;
        bool useMultiplier;
        bool checkOraclePaused;
        bool createVault; // wave 1 = true
    }

    struct Deployed {
        TimelockController timelock;
        ParamController params;
        SessionController sessions;
        OracleRouter oracle;
        EligibilityRegistry eligibility;
        FeeCollector feeCollector;
        VaultFactory factory;
        SwapRouter router;
        RfqSettlement rfq;
        UniswapV3Adapter uniswapAdapter;
    }

    function _configJson() internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), "/../config/protocol.json"));
    }

    function _holidaysJson() internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), "/../config/holidays.json"));
    }

    function _tierFromJson(string memory json, string memory key) internal pure returns (TierParams memory t) {
        string memory b = string.concat(".tiers.", key, ".");
        t.halfSpreadBps = uint16(vm.parseJsonUint(json, string.concat(b, "halfSpreadBps")));
        t.skewBps = uint16(vm.parseJsonUint(json, string.concat(b, "skewBps")));
        t.bandBps = uint16(vm.parseJsonUint(json, string.concat(b, "bandBps")));
        t.clipUsd = uint64(vm.parseJsonUint(json, string.concat(b, "clipUsd")));
        t.capUsd = uint64(vm.parseJsonUint(json, string.concat(b, "capUsd")));
    }

    function _sessionFromJson(string memory json, string memory key) internal pure returns (SessionParams memory s) {
        string memory b = string.concat(".sessions.", key, ".");
        s.spreadMulBps = uint32(vm.parseJsonUint(json, string.concat(b, "spreadMulBps")));
        s.clipMulBps = uint32(vm.parseJsonUint(json, string.concat(b, "clipMulBps")));
        s.bandMulBps = uint32(vm.parseJsonUint(json, string.concat(b, "bandMulBps")));
        s.vaultOpen = vm.parseJsonBool(json, string.concat(b, "vaultOpen"));
    }

    function tierIndex(string memory json, string memory tierKey) internal pure returns (uint8) {
        return uint8(vm.parseJsonUint(json, string.concat(".tiers.", tierKey, ".index")));
    }

    /// @param deployer the account sending these transactions (owner until handover)
    /// @param timelockDelay seconds; config value on testnet/mainnet, may be 0 on anvil
    function _deployCore(
        address deployer,
        Roles memory roles,
        External memory ext,
        StockCfg[] memory stocks,
        bool enforceEligibility,
        uint256 timelockDelay
    ) internal returns (Deployed memory d) {
        string memory cfg = _configJson();

        d.params = new ParamController(deployer, roles.guardian);
        d.sessions = new SessionController(deployer);
        d.oracle = new OracleRouter(deployer);
        d.eligibility = new EligibilityRegistry(deployer, roles.guardian, enforceEligibility);
        d.feeCollector = new FeeCollector(deployer);
        d.factory = new VaultFactory(
            deployer,
            ext.usdg,
            address(d.params),
            address(d.oracle),
            address(d.sessions),
            address(d.eligibility),
            address(d.feeCollector)
        );
        d.router = new SwapRouter(
            deployer,
            ext.usdg,
            address(d.params),
            address(d.oracle),
            address(d.sessions),
            address(d.eligibility),
            address(d.factory),
            address(d.feeCollector)
        );
        d.factory.setRouter(address(d.router));
        d.rfq = new RfqSettlement(deployer, address(d.router), address(d.params), ext.usdg, address(d.feeCollector));
        d.uniswapAdapter = new UniswapV3Adapter(address(d.router), ext.swapRouter02);
        d.router.setVenue(Venue.Uniswap, address(d.uniswapAdapter));
        d.router.setVenue(Venue.Rfq, address(d.rfq));

        // parameters
        d.params.setTier(0, _tierFromJson(cfg, "A"));
        d.params.setTier(1, _tierFromJson(cfg, "B"));
        d.params.setTier(2, _tierFromJson(cfg, "C"));
        d.params.setSession(Session.Regular, _sessionFromJson(cfg, "regular"));
        d.params.setSession(Session.Extended, _sessionFromJson(cfg, "extended"));
        d.params.setSession(Session.Overnight, _sessionFromJson(cfg, "overnight"));
        d.params.setSession(Session.Closed, _sessionFromJson(cfg, "closed"));
        d.params.setFees(
            uint16(vm.parseJsonUint(cfg, ".fees.protocolFeeBps")),
            uint16(vm.parseJsonUint(cfg, ".fees.rfqFeeBps")),
            uint16(vm.parseJsonUint(cfg, ".fees.spreadShareBps"))
        );
        d.params.setRfqLimits(
            uint64(vm.parseJsonUint(cfg, ".rfq.minUsd")), uint64(vm.parseJsonUint(cfg, ".rfq.maxUsd"))
        );
        d.params.setOracleAges(
            uint32(vm.parseJsonUint(cfg, ".oracle.vaultMaxAgeSec")),
            uint32(vm.parseJsonUint(cfg, ".oracle.bandMaxAgeSec"))
        );
        d.oracle.setSequencerFeed(ext.sequencerFeed, uint32(vm.parseJsonUint(cfg, ".oracle.sequencerGraceSec")));

        // calendar
        string memory hol = _holidaysJson();
        d.sessions.setHolidays(vm.parseJsonUintArray(hol, ".holidayDays"), true);
        d.sessions.setEarlyCloses(vm.parseJsonUintArray(hol, ".earlyCloseDays"), true);

        // eligibility
        if (roles.attester != address(0)) d.eligibility.setAttester(roles.attester, true);
        if (roles.rfqMaker != address(0)) d.rfq.setMaker(roles.rfqMaker, true);

        // markets
        for (uint256 i; i < stocks.length; ++i) {
            StockCfg memory s = stocks[i];
            d.params.setMarket(s.token, s.tier, true);
            d.oracle.setFeed(s.token, s.feed, s.useMultiplier, s.checkOraclePaused);
            if (s.createVault) d.factory.createVault(s.token);
        }

        // governance handover: everything is owned by the timelock from here on
        address[] memory proposers = new address[](1);
        proposers[0] = roles.multisig;
        address[] memory executors = new address[](1);
        executors[0] = roles.multisig;
        d.timelock = new TimelockController(timelockDelay, proposers, executors, address(0));
        address tl = address(d.timelock);
        Ownable(address(d.params)).transferOwnership(tl);
        Ownable(address(d.sessions)).transferOwnership(tl);
        Ownable(address(d.oracle)).transferOwnership(tl);
        Ownable(address(d.eligibility)).transferOwnership(tl);
        Ownable(address(d.feeCollector)).transferOwnership(tl);
        Ownable(address(d.factory)).transferOwnership(tl);
        Ownable(address(d.router)).transferOwnership(tl);
        Ownable(address(d.rfq)).transferOwnership(tl);
    }
}
