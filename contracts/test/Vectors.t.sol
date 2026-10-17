// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {SessionLib} from "../src/libraries/SessionLib.sol";
import {VaultMath} from "../src/libraries/VaultMath.sol";

/// @notice spec/vectors/*.json come from spec/generate_vectors.py (an independent Python reference).
/// packages/shared runs the same files, so Solidity, TypeScript and Python agree to the last wei.
contract VectorsTest is Base {
    function _root() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/../spec/vectors/");
    }

    function test_SessionVectors() public view {
        string memory json = vm.readFile(string.concat(_root(), "sessions.json"));
        uint256 n = vm.parseJsonUint(json, ".count");
        assertGt(n, 500);
        for (uint256 i; i < n; ++i) {
            string memory k = string.concat(".vectors[", vm.toString(i), "].");
            uint256 ts = vm.parseJsonUint(json, string.concat(k, "ts"));
            (uint256 day, uint256 minute) = SessionLib.toNewYork(ts);
            assertEq(day, vm.parseJsonUint(json, string.concat(k, "nyDay")), string.concat("day ", vm.toString(ts)));
            assertEq(minute, vm.parseJsonUint(json, string.concat(k, "nyMinute")), string.concat("min ", vm.toString(ts)));
            assertEq(SessionLib.isDst(ts), vm.parseJsonBool(json, string.concat(k, "dst")), "dst");
            assertEq(
                uint256(d.sessions.sessionAt(ts)),
                vm.parseJsonUint(json, string.concat(k, "session")),
                vm.parseJsonString(json, string.concat(k, "note"))
            );
        }
    }

    function test_VaultQuoteVectors() public view {
        string memory json = vm.readFile(string.concat(_root(), "vault-quotes.json"));
        uint256 n = vm.parseJsonUint(json, ".count");
        for (uint256 i; i < n; ++i) {
            string memory k = string.concat(".vectors[", vm.toString(i), "].");
            VaultMath.Pool memory p = VaultMath.Pool(
                vm.parseJsonUint(json, string.concat(k, "priceWad")),
                vm.parseJsonUint(json, string.concat(k, "reserveStock")),
                vm.parseJsonUint(json, string.concat(k, "reserveUsd")),
                10 ** vm.parseJsonUint(json, string.concat(k, "stockDecimals")),
                10 ** (18 - vm.parseJsonUint(json, string.concat(k, "usdDecimals")))
            );
            VaultMath.Pricing memory q = VaultMath.Pricing(
                vm.parseJsonUint(json, string.concat(k, "halfSpreadBps")),
                vm.parseJsonUint(json, string.concat(k, "skewBps")),
                vm.parseJsonUint(json, string.concat(k, "spreadMulBps")),
                vm.parseJsonUint(json, string.concat(k, "spreadShareBps"))
            );
            bool buy = vm.parseJsonBool(json, string.concat(k, "buy"));
            VaultMath.Result memory r = VaultMath.quote(p, q, buy, vm.parseJsonUint(json, string.concat(k, "amountIn")));
            string memory tag = string.concat("vector ", vm.toString(i));
            assertEq(r.amountOut, vm.parseJsonUint(json, string.concat(k, "amountOut")), tag);
            assertEq(r.costWad, vm.parseJsonUint(json, string.concat(k, "costWad")), tag);
            assertEq(r.notionalWad, vm.parseJsonUint(json, string.concat(k, "notionalWad")), tag);
            assertEq(r.spreadShare, vm.parseJsonUint(json, string.concat(k, "spreadShare")), tag);
            assertEq(r.imbalanceWad, vm.parseJsonInt(json, string.concat(k, "imbalanceWad")), tag);
        }
    }
}
