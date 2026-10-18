// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ZeroAddress, NotGuardian, BadAttestation} from "./libraries/Errors.sol";

/// @notice Who may trade or provide liquidity. Robinhood Stock Tokens are not offered to US persons,
/// so on mainnet `enforced` must be true and wallets need a fresh attestation from an approved
/// attester (your KYC / geofencing provider signs it off-chain; anyone can submit it on-chain).
/// The exact eligibility rules are a legal decision for ALFA (see docs/DECISIONS.md).
contract EligibilityRegistry is Ownable, EIP712 {
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(address account,uint64 validUntil,uint64 issuedAt)");
    uint64 public constant MAX_ATTESTATION_AGE = 1 days; // signature must be submitted within a day
    uint64 public constant MAX_VALIDITY = 365 days; // no attestation lasts longer, whatever an attester signs

    bool public enforced;
    address public guardian; // may block accounts and revoke attesters, never unblock
    mapping(address => bool) public isAttester;
    mapping(address => uint64) public validUntil;
    mapping(address => address) public attesterOf; // who signed the attestation behind validUntil
    mapping(address => bool) public blocked;
    mapping(address => bool) public isExempt; // protocol contracts (vaults, router) that hold tokens

    event EnforcedSet(bool enforced);
    event GuardianSet(address guardian);
    event AttesterSet(address indexed attester, bool on);
    event Attested(address indexed account, uint64 validUntil, address indexed attester);
    event BlockedSet(address indexed account, bool blocked);
    event ExemptSet(address indexed account, bool exempt);

    constructor(address owner_, address guardian_, bool enforced_) Ownable(owner_) EIP712("Paritas Eligibility", "1") {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        enforced = enforced_;
        emit GuardianSet(guardian_);
        emit EnforcedSet(enforced_);
    }

    function isEligible(address account) external view returns (bool) {
        if (blocked[account]) return false;
        if (!enforced || isExempt[account]) return true;
        // revoking an attester revokes every attestation it signed
        return validUntil[account] >= block.timestamp && isAttester[attesterOf[account]];
    }

    /// @notice Submit an attester's EIP-712 signature for `account`.
    function attest(address account, uint64 until, uint64 issuedAt, bytes calldata signature) external {
        if (until <= block.timestamp || issuedAt > block.timestamp) revert BadAttestation();
        if (block.timestamp - issuedAt > MAX_ATTESTATION_AGE) revert BadAttestation();
        if (until - issuedAt > MAX_VALIDITY) revert BadAttestation();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, account, until, issuedAt)));
        address signer = ECDSA.recover(digest, signature);
        if (!isAttester[signer]) revert BadAttestation();
        if (until > validUntil[account] || !isAttester[attesterOf[account]]) {
            validUntil[account] = until;
            attesterOf[account] = signer;
        }
        emit Attested(account, validUntil[account], attesterOf[account]);
    }

    function attestationDigest(address account, uint64 until, uint64 issuedAt) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, account, until, issuedAt)));
    }

    // ---------------------------------------------------------------- governance

    function setEnforced(bool on) external onlyOwner {
        enforced = on;
        emit EnforcedSet(on);
    }

    function setGuardian(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        guardian = g;
        emit GuardianSet(g);
    }

    function setAttester(address a, bool on) external onlyOwner {
        isAttester[a] = on;
        emit AttesterSet(a, on);
    }

    function setExempt(address a, bool on) external onlyOwner {
        isExempt[a] = on;
        emit ExemptSet(a, on);
    }

    function unblockAccounts(address[] calldata accounts) external onlyOwner {
        for (uint256 i; i < accounts.length; ++i) {
            blocked[accounts[i]] = false;
            emit BlockedSet(accounts[i], false);
        }
    }

    // ---------------------------------------------------------------- guardian (restrictive only)

    function blockAccounts(address[] calldata accounts) external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        for (uint256 i; i < accounts.length; ++i) {
            blocked[accounts[i]] = true;
            emit BlockedSet(accounts[i], true);
        }
    }

    function revokeAttester(address a) external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        isAttester[a] = false;
        emit AttesterSet(a, false);
    }
}
