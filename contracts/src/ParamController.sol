// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Session, TierParams, SessionParams, Market} from "./libraries/Types.sol";
import {ZeroAddress, NotGuardian, OutOfBounds, MarketNotListed} from "./libraries/Errors.sol";

/// @notice Every tunable number in the protocol. Owner is the 48h TimelockController.
/// The guardian can only pause; unpausing and every parameter change goes through the timelock.
/// Hard bounds below are code constants so even a compromised timelock cannot set abusive values.
contract ParamController is Ownable {
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 30;
    uint16 public constant MAX_RFQ_FEE_BPS = 30;
    uint16 public constant MAX_SPREAD_SHARE_BPS = 5_000;
    uint16 public constant MAX_HALF_SPREAD_BPS = 500;
    uint16 public constant MAX_SKEW_BPS = 500;
    uint16 public constant MAX_BAND_BPS = 1_000;
    uint32 public constant MAX_MUL_BPS = 50_000;
    uint8 public constant TIER_COUNT = 3;

    address public guardian;
    bool public globalPaused;

    TierParams[TIER_COUNT] internal _tiers;
    mapping(Session => SessionParams) internal _sessions;
    mapping(address stock => Market) internal _markets;
    address[] internal _marketList;

    uint16 public protocolFeeBps;
    uint16 public rfqFeeBps; // paid by the maker, never shown as a taker cost
    uint16 public spreadShareBps; // share of vault spread revenue sent to the FeeCollector
    uint64 public rfqMinUsd;
    uint64 public rfqMaxUsd;
    uint32 public vaultMaxOracleAge; // vault quotes and deposits need a price at most this old
    uint32 public bandMaxOracleAge; // band checks on Uniswap/RFQ legs (longer: works over weekends)

    event GuardianSet(address guardian);
    event TierSet(uint8 indexed tier, TierParams params);
    event SessionParamsSet(Session indexed session, SessionParams params);
    event FeesSet(uint16 protocolFeeBps, uint16 rfqFeeBps, uint16 spreadShareBps);
    event RfqLimitsSet(uint64 minUsd, uint64 maxUsd);
    event OracleAgesSet(uint32 vaultMaxOracleAge, uint32 bandMaxOracleAge);
    event MarketSet(address indexed stock, uint8 tier, bool listed);
    event GlobalPauseSet(bool paused);
    event MarketPauseSet(address indexed stock, bool paused);

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _;
    }

    constructor(address owner_, address guardian_) Ownable(owner_) {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    // ---------------------------------------------------------------- governance (timelock)

    function setGuardian(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        guardian = g;
        emit GuardianSet(g);
    }

    function setTier(uint8 tierIdx, TierParams calldata p) external onlyOwner {
        if (tierIdx >= TIER_COUNT) revert OutOfBounds("tier");
        if (p.halfSpreadBps > MAX_HALF_SPREAD_BPS) revert OutOfBounds("halfSpreadBps");
        if (p.skewBps > MAX_SKEW_BPS) revert OutOfBounds("skewBps");
        if (p.bandBps == 0 || p.bandBps > MAX_BAND_BPS) revert OutOfBounds("bandBps");
        if (p.bandBps <= protocolFeeBps) revert OutOfBounds("bandBps<=fee");
        if (p.clipUsd == 0 || p.capUsd < p.clipUsd) revert OutOfBounds("clip/cap");
        _tiers[tierIdx] = p;
        emit TierSet(tierIdx, p);
    }

    function setSession(Session s, SessionParams calldata p) external onlyOwner {
        if (p.spreadMulBps > MAX_MUL_BPS || p.clipMulBps > MAX_MUL_BPS) revert OutOfBounds("mul");
        if (p.bandMulBps < 10_000 || p.bandMulBps > MAX_MUL_BPS) revert OutOfBounds("bandMul");
        if (p.vaultOpen && (p.spreadMulBps < 10_000 || p.clipMulBps == 0)) revert OutOfBounds("open session");
        if (s == Session.Closed && p.vaultOpen) revert OutOfBounds("closed session cannot open vaults");
        _sessions[s] = p;
        emit SessionParamsSet(s, p);
    }

    function setFees(uint16 protocolFee, uint16 rfqFee, uint16 spreadShare) external onlyOwner {
        if (protocolFee > MAX_PROTOCOL_FEE_BPS) revert OutOfBounds("protocolFeeBps");
        if (rfqFee > MAX_RFQ_FEE_BPS) revert OutOfBounds("rfqFeeBps");
        if (spreadShare > MAX_SPREAD_SHARE_BPS) revert OutOfBounds("spreadShareBps");
        for (uint8 i; i < TIER_COUNT; ++i) {
            if (_tiers[i].bandBps != 0 && _tiers[i].bandBps <= protocolFee) revert OutOfBounds("fee>=band");
        }
        protocolFeeBps = protocolFee;
        rfqFeeBps = rfqFee;
        spreadShareBps = spreadShare;
        emit FeesSet(protocolFee, rfqFee, spreadShare);
    }

    function setRfqLimits(uint64 minUsd, uint64 maxUsd) external onlyOwner {
        if (minUsd == 0 || maxUsd < minUsd) revert OutOfBounds("rfq limits");
        rfqMinUsd = minUsd;
        rfqMaxUsd = maxUsd;
        emit RfqLimitsSet(minUsd, maxUsd);
    }

    function setOracleAges(uint32 vaultAge, uint32 bandAge) external onlyOwner {
        if (vaultAge == 0 || bandAge < vaultAge || bandAge > 7 days) revert OutOfBounds("oracle ages");
        vaultMaxOracleAge = vaultAge;
        bandMaxOracleAge = bandAge;
        emit OracleAgesSet(vaultAge, bandAge);
    }

    function setMarket(address stock, uint8 tierIdx, bool listed) external onlyOwner {
        if (stock == address(0)) revert ZeroAddress();
        if (tierIdx >= TIER_COUNT) revert OutOfBounds("tier");
        Market storage m = _markets[stock];
        if (!m.listed && listed) {
            bool known;
            for (uint256 i; i < _marketList.length; ++i) {
                if (_marketList[i] == stock) known = true;
            }
            if (!known) _marketList.push(stock);
        }
        m.listed = listed;
        m.tier = tierIdx;
        emit MarketSet(stock, tierIdx, listed);
    }

    // ---------------------------------------------------------------- pause (guardian may pause, only timelock unpauses)

    function pauseAll() external onlyGuardianOrOwner {
        globalPaused = true;
        emit GlobalPauseSet(true);
    }

    function unpauseAll() external onlyOwner {
        globalPaused = false;
        emit GlobalPauseSet(false);
    }

    function pauseMarket(address stock) external onlyGuardianOrOwner {
        if (!_markets[stock].listed) revert MarketNotListed();
        _markets[stock].paused = true;
        emit MarketPauseSet(stock, true);
    }

    function unpauseMarket(address stock) external onlyOwner {
        _markets[stock].paused = false;
        emit MarketPauseSet(stock, false);
    }

    // ---------------------------------------------------------------- views

    function tier(uint8 t) external view returns (TierParams memory) {
        return _tiers[t];
    }

    function tierOf(address stock) external view returns (TierParams memory) {
        Market memory m = _markets[stock];
        if (!m.listed) revert MarketNotListed();
        return _tiers[m.tier];
    }

    function sessionParams(Session s) external view returns (SessionParams memory) {
        return _sessions[s];
    }

    function market(address stock) external view returns (Market memory) {
        return _markets[stock];
    }

    function markets() external view returns (address[] memory) {
        return _marketList;
    }

    function isActive(address stock) external view returns (bool) {
        Market memory m = _markets[stock];
        return !globalPaused && m.listed && !m.paused;
    }
}
