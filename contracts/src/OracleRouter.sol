// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface, IStockToken} from "./interfaces/External.sol";
import {
    ZeroAddress,
    NoFeed,
    BadOracleAnswer,
    StaleOracle,
    SequencerDown,
    SequencerGracePeriod,
    OraclePausedByIssuer
} from "./libraries/Errors.sol";

/// @notice Normalises Chainlink prices to USD per 1 whole stock token, 18 decimals ("WAD").
/// Any contract exposing AggregatorV3Interface can be plugged in, so a Chainlink Data Streams
/// adapter can replace a Data Feed later without touching the vault or the router.
contract OracleRouter is Ownable {
    struct Feed {
        AggregatorV3Interface aggregator;
        uint8 decimals;
        bool useMultiplier; // multiply by stock.uiMultiplier() / 1e18 (VERIFY semantics first)
        bool checkIssuerPause; // honour stock.oraclePaused() for vault pricing
    }

    mapping(address stock => Feed) public feeds;
    AggregatorV3Interface public sequencerFeed; // Chainlink L2 sequencer uptime feed; zero disables (VERIFY it exists)
    uint32 public sequencerGrace = 3600;

    event FeedSet(address indexed stock, address aggregator, bool useMultiplier, bool checkIssuerPause);
    event SequencerFeedSet(address feed, uint32 grace);

    constructor(address owner_) Ownable(owner_) {}

    function setFeed(address stock, address aggregator, bool useMultiplier, bool checkIssuerPause)
        external
        onlyOwner
    {
        if (stock == address(0) || aggregator == address(0)) revert ZeroAddress();
        uint8 dec = AggregatorV3Interface(aggregator).decimals();
        feeds[stock] = Feed(AggregatorV3Interface(aggregator), dec, useMultiplier, checkIssuerPause);
        emit FeedSet(stock, aggregator, useMultiplier, checkIssuerPause);
    }

    function setSequencerFeed(address feed, uint32 grace) external onlyOwner {
        sequencerFeed = AggregatorV3Interface(feed);
        sequencerGrace = grace;
        emit SequencerFeedSet(feed, grace);
    }

    /// @return priceWad USD per whole token, 18 decimals
    /// @return updatedAt feed timestamp
    function price(address stock) public view returns (uint256 priceWad, uint256 updatedAt) {
        _checkSequencer();
        Feed memory f = feeds[stock];
        if (address(f.aggregator) == address(0)) revert NoFeed();
        (, int256 answer,, uint256 upd,) = f.aggregator.latestRoundData();
        if (answer <= 0 || upd == 0 || upd > block.timestamp) revert BadOracleAnswer();
        priceWad = f.decimals <= 18
            ? uint256(answer) * 10 ** (18 - f.decimals)
            : uint256(answer) / 10 ** (f.decimals - 18);
        if (f.useMultiplier) {
            uint256 mult = IStockToken(stock).uiMultiplier();
            if (mult == 0) revert BadOracleAnswer();
            priceWad = priceWad * mult / 1e18;
        }
        updatedAt = upd;
    }

    /// @notice Price for band checks. Reverts if older than maxAge.
    function priceNoOlderThan(address stock, uint256 maxAge) public view returns (uint256 priceWad) {
        uint256 updatedAt;
        (priceWad, updatedAt) = price(stock);
        if (block.timestamp - updatedAt > maxAge) revert StaleOracle(updatedAt, maxAge);
    }

    /// @notice Price for vault quotes and deposits: fresh, and the issuer has not flagged the price.
    function vaultPrice(address stock, uint256 maxAge) external view returns (uint256 priceWad) {
        priceWad = priceNoOlderThan(stock, maxAge);
        if (feeds[stock].checkIssuerPause && IStockToken(stock).oraclePaused()) revert OraclePausedByIssuer();
    }

    function _checkSequencer() internal view {
        if (address(sequencerFeed) == address(0)) return;
        (, int256 answer, uint256 startedAt,,) = sequencerFeed.latestRoundData();
        if (answer != 0) revert SequencerDown(); // 0 = up, 1 = down
        if (startedAt == 0 || block.timestamp - startedAt <= sequencerGrace) revert SequencerGracePeriod();
    }
}
