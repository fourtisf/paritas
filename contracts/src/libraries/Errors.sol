// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

// Shared custom errors. The web app maps these selectors to plain-language messages
// (packages/shared/src/errors.ts). Add new ones at the end.

error ZeroAddress();
error ZeroAmount();
error NotRouter();
error NotGuardian();
error OutOfBounds(string what);
error AlreadySet();

// markets and sessions
error MarketNotListed();
error MarketPaused();
error VaultClosed();
error NoVault();

// oracle
error NoFeed();
error BadOracleAnswer();
error StaleOracle(uint256 updatedAt, uint256 maxAge);
error SequencerDown();
error SequencerGracePeriod();
error OraclePausedByIssuer();

// eligibility
error NotEligible(address account);
error BadAttestation();

// vault
error AboveClip(uint256 notionalUsdWad, uint256 clipUsdWad);
error InsufficientInventory();
error AboveCap();
error SlippageExceeded();

// router
error Expired();
error BadLegs();
error LegSumMismatch(uint256 legs, uint256 expected);
error OutsideBand(uint256 legIndex);
error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);
error VenueNotSet();

// rfq
error NotMaker();
error WrongTaker();
error QuoteExpired();
error NonceUsed();
error BadSignature();
error QuoteMismatch();
error RfqSizeOutOfRange(uint256 notionalUsdWad);
