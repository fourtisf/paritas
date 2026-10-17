// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base} from "./Base.t.sol";
import {Session, Venue, TierParams, SessionParams} from "../src/libraries/Types.sol";
import "../src/libraries/Errors.sol";

contract GovernanceTest is Base {
    function test_DeployWiring() public view {
        address[8] memory owned = [
            address(d.params),
            address(d.sessions),
            address(d.oracle),
            address(d.eligibility),
            address(d.feeCollector),
            address(d.factory),
            address(d.router),
            address(d.rfq)
        ];
        for (uint256 i; i < owned.length; ++i) {
            assertEq(Ownable(owned[i]).owner(), tl, "every contract is owned by the timelock");
        }
        assertEq(d.timelock.getMinDelay(), 2 days);
        assertTrue(d.timelock.hasRole(d.timelock.PROPOSER_ROLE(), multisig));
        assertEq(d.factory.router(), address(d.router));
        assertEq(d.router.venue(Venue.Uniswap), address(d.uniswapAdapter));
        assertEq(d.router.venue(Venue.Rfq), address(d.rfq));
        assertEq(d.params.protocolFeeBps(), 2);
        assertEq(d.params.tier(0).bandBps, 75);
        assertEq(d.params.sessionParams(Session.Overnight).spreadMulBps, 20_000);
        assertFalse(d.params.sessionParams(Session.Closed).vaultOpen);
    }

    function test_HolidaysLoadedFromConfig() public view {
        assertTrue(d.sessions.isHoliday(20_783)); // 2026-11-26 Thanksgiving
        assertTrue(d.sessions.isEarlyClose(20_784)); // 2026-11-27
    }

    function test_ParamChangeNeedsTheFullDelay() public {
        bytes memory data = abi.encodeCall(d.params.setFees, (uint16(3), uint16(2), uint16(1000)));
        bytes32 salt = keccak256("fee");
        vm.prank(multisig);
        d.timelock.schedule(address(d.params), 0, data, bytes32(0), salt, 2 days);
        vm.warp(block.timestamp + 2 days - 1);
        vm.prank(multisig);
        vm.expectRevert();
        d.timelock.execute(address(d.params), 0, data, bytes32(0), salt);
        vm.warp(block.timestamp + 1);
        vm.prank(multisig);
        d.timelock.execute(address(d.params), 0, data, bytes32(0), salt);
        assertEq(d.params.protocolFeeBps(), 3);
    }

    function test_NobodyElseCanChangeParams() public {
        vm.expectRevert();
        d.params.setFees(30, 2, 1000);
        vm.prank(guardian);
        vm.expectRevert();
        d.params.setFees(30, 2, 1000);
        vm.prank(multisig); // even the multisig must go through the timelock
        vm.expectRevert();
        d.params.setFees(30, 2, 1000);
    }

    function test_HardBoundsHoldEvenForTheTimelock() public {
        vm.startPrank(tl);
        vm.expectRevert(abi.encodeWithSelector(OutOfBounds.selector, "protocolFeeBps"));
        d.params.setFees(31, 2, 1000);
        vm.expectRevert(abi.encodeWithSelector(OutOfBounds.selector, "closed session cannot open vaults"));
        d.params.setSession(Session.Closed, SessionParams(10_000, 10_000, 10_000, true));
        vm.expectRevert(abi.encodeWithSelector(OutOfBounds.selector, "bandBps"));
        d.params.setTier(0, TierParams(10, 15, 1_001, 50_000, 2_500_000));
        vm.expectRevert(abi.encodeWithSelector(OutOfBounds.selector, "bandBps<=fee"));
        d.params.setTier(0, TierParams(10, 15, 2, 50_000, 2_500_000));
        vm.stopPrank();
    }

    function test_FeeCollectorOnlyPaysOutThroughTimelock() public {
        _swap(_oneLeg(address(nvda), true, 10_000e6, Venue.Vault, ""));
        uint256 bal = usdg.balanceOf(address(d.feeCollector));
        assertGt(bal, 0);
        vm.prank(multisig);
        vm.expectRevert();
        d.feeCollector.sweep(address(usdg), multisig, bal);
        _govern(address(d.feeCollector), abi.encodeCall(d.feeCollector.sweep, (address(usdg), multisig, bal)));
        assertEq(usdg.balanceOf(multisig), bal);
    }

    function test_GuardianCanBlockButNotUnblock() public {
        address[] memory a = new address[](1);
        a[0] = trader;
        vm.prank(guardian);
        d.eligibility.blockAccounts(a);
        assertFalse(d.eligibility.isEligible(trader));
        vm.prank(guardian);
        vm.expectRevert();
        d.eligibility.unblockAccounts(a);
    }

    function test_AttestationRules() public {
        uint64 until = uint64(block.timestamp + 30 days);
        uint64 issuedAt = uint64(block.timestamp - 2 days); // too old to submit
        bytes32 digest = d.eligibility.attestationDigest(outsider, until, issuedAt);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterPk, digest);
        vm.expectRevert(BadAttestation.selector);
        d.eligibility.attest(outsider, until, issuedAt, abi.encodePacked(r, s, v));

        issuedAt = uint64(block.timestamp);
        digest = d.eligibility.attestationDigest(outsider, until, issuedAt);
        (v, r, s) = vm.sign(0xBEEF, digest); // not an attester
        vm.expectRevert(BadAttestation.selector);
        d.eligibility.attest(outsider, until, issuedAt, abi.encodePacked(r, s, v));

        (v, r, s) = vm.sign(attesterPk, digest);
        d.eligibility.attest(outsider, until, issuedAt, abi.encodePacked(r, s, v));
        assertTrue(d.eligibility.isEligible(outsider));
        vm.warp(until + 1);
        assertFalse(d.eligibility.isEligible(outsider), "attestations expire");
    }
}
