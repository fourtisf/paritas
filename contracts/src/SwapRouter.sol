// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Session, Venue, Leg, SwapParams, RfqQuote, TierParams, SessionParams, Constants} from "./libraries/Types.sol";
import {IVenueAdapter} from "./interfaces/External.sol";
import {ParamController} from "./ParamController.sol";
import {OracleRouter} from "./OracleRouter.sol";
import {SessionController} from "./SessionController.sol";
import {EligibilityRegistry} from "./EligibilityRegistry.sol";
import {VaultFactory} from "./VaultFactory.sol";
import {AnchorVault} from "./AnchorVault.sol";
import {RfqSettlement} from "./RfqSettlement.sol";
import {
    ZeroAddress,
    ZeroAmount,
    Expired,
    MarketPaused,
    BadLegs,
    LegSumMismatch,
    OutsideBand,
    InsufficientOutput,
    VenueNotSet,
    NoVault,
    NotEligible,
    QuoteMismatch
} from "./libraries/Errors.sol";

/// @notice The only entry point for trades. Executes legs built by the off-chain router across the
/// Paritas vault, Uniswap and RFQ makers, and enforces on-chain:
///  - every leg's all-in cost versus the Chainlink price stays inside the tier band (x session band multiplier)
///  - the total output meets minAmountOut after the protocol fee
///  - protocol fee = protocolFeeBps of the USDG side (taken from the input on buys, from the output on sells)
///  - one Fill event per leg and one RouteExecuted per trade: this is the receipt the app shows
contract SwapRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_LEGS = 6;

    IERC20 public immutable usdg;
    ParamController public immutable params;
    OracleRouter public immutable oracle;
    SessionController public immutable sessions;
    EligibilityRegistry public immutable eligibility;
    VaultFactory public immutable factory;
    address public immutable feeCollector;
    uint256 public immutable usdToWad;

    mapping(Venue => address) public venue; // Uniswap -> adapter, Rfq -> RfqSettlement
    uint256 public routeCount;

    event VenueSet(Venue indexed v, address target);
    event Fill(
        uint256 indexed routeId,
        Venue indexed venue,
        address indexed stock,
        uint256 legIndex,
        uint256 amountIn,
        uint256 amountOut,
        uint256 priceWad
    );
    event RouteExecuted(
        uint256 indexed routeId,
        address indexed trader,
        address indexed stock,
        address recipient,
        bool buy,
        uint256 amountIn,
        uint256 amountOut,
        uint256 protocolFee,
        uint256 oraclePriceWad,
        uint8 session
    );

    struct Ctx {
        uint256 id;
        uint256 priceWad;
        uint256 stockUnit;
        uint256 allowedBps;
        Session session;
        IERC20 tokenIn;
        IERC20 tokenOut;
    }

    constructor(
        address owner_,
        address usdg_,
        address params_,
        address oracle_,
        address sessions_,
        address eligibility_,
        address factory_,
        address feeCollector_
    ) Ownable(owner_) {
        if (
            usdg_ == address(0) || params_ == address(0) || oracle_ == address(0) || sessions_ == address(0)
                || eligibility_ == address(0) || factory_ == address(0) || feeCollector_ == address(0)
        ) revert ZeroAddress();
        usdg = IERC20(usdg_);
        params = ParamController(params_);
        oracle = OracleRouter(oracle_);
        sessions = SessionController(sessions_);
        eligibility = EligibilityRegistry(eligibility_);
        factory = VaultFactory(factory_);
        feeCollector = feeCollector_;
        usdToWad = 10 ** (18 - IERC20Metadata(usdg_).decimals());
    }

    function setVenue(Venue v, address target) external onlyOwner {
        if (v == Venue.Vault) revert BadLegs(); // vaults come from the factory
        venue[v] = target;
        emit VenueSet(v, target);
    }

    /// @notice Max all-in cost (bps) a leg may have right now for `stock`: band * bandMul - protocol fee.
    function allowedLegCostBps(address stock) public view returns (uint256) {
        TierParams memory t = params.tierOf(stock);
        SessionParams memory sp = params.sessionParams(sessions.current());
        uint256 band = uint256(t.bandBps) * sp.bandMulBps / Constants.BPS;
        uint256 fee = params.protocolFeeBps();
        return band > fee ? band - fee : 0;
    }

    function swap(SwapParams calldata p) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > p.deadline) revert Expired();
        if (p.recipient == address(0)) revert ZeroAddress();
        if (p.amountIn == 0) revert ZeroAmount();
        if (p.legs.length == 0 || p.legs.length > MAX_LEGS) revert BadLegs();
        if (!params.isActive(p.stock)) revert MarketPaused();
        if (!eligibility.isEligible(msg.sender)) revert NotEligible(msg.sender);
        if (!eligibility.isEligible(p.recipient)) revert NotEligible(p.recipient);

        Ctx memory c;
        c.id = ++routeCount;
        c.priceWad = oracle.priceNoOlderThan(p.stock, params.bandMaxOracleAge());
        c.stockUnit = 10 ** IERC20Metadata(p.stock).decimals();
        c.allowedBps = allowedLegCostBps(p.stock);
        c.session = sessions.current();
        c.tokenIn = p.buy ? usdg : IERC20(p.stock);
        c.tokenOut = p.buy ? IERC20(p.stock) : usdg;

        c.tokenIn.safeTransferFrom(msg.sender, address(this), p.amountIn);

        uint256 feeBps = params.protocolFeeBps();
        uint256 fee;
        uint256 toRoute = p.amountIn;
        if (p.buy) {
            fee = p.amountIn * feeBps / Constants.BPS;
            toRoute -= fee;
        }

        uint256 legSum;
        bool vaultLeg;
        for (uint256 i; i < p.legs.length; ++i) {
            if (p.legs[i].amountIn == 0) revert BadLegs();
            // one vault leg per route, so the vault's largest order (clip) holds for the whole trade
            if (p.legs[i].venue == Venue.Vault) {
                if (vaultLeg) revert BadLegs();
                vaultLeg = true;
            }
            legSum += p.legs[i].amountIn;
        }
        if (legSum != toRoute) revert LegSumMismatch(legSum, toRoute);

        uint256 gross;
        for (uint256 i; i < p.legs.length; ++i) {
            Leg calldata leg = p.legs[i];
            uint256 out = _executeLeg(p, leg, c);
            _checkBand(p.buy, leg.amountIn, out, c, i);
            gross += out;
            emit Fill(c.id, leg.venue, p.stock, i, leg.amountIn, out, _execPrice(p.buy, leg.amountIn, out, c));
        }

        amountOut = gross;
        if (!p.buy) {
            fee = gross * feeBps / Constants.BPS;
            amountOut = gross - fee;
        }
        if (amountOut < p.minAmountOut) revert InsufficientOutput(amountOut, p.minAmountOut);

        if (fee > 0) usdg.safeTransfer(feeCollector, fee);
        c.tokenOut.safeTransfer(p.recipient, amountOut);

        emit RouteExecuted(
            c.id, msg.sender, p.stock, p.recipient, p.buy, p.amountIn, amountOut, fee, c.priceWad, uint8(c.session)
        );
    }

    // ---------------------------------------------------------------- internal

    function _executeLeg(SwapParams calldata p, Leg calldata leg, Ctx memory c) internal returns (uint256 out) {
        uint256 before = c.tokenOut.balanceOf(address(this));
        if (leg.venue == Venue.Vault) {
            address v = factory.vaultOf(p.stock);
            if (v == address(0)) revert NoVault();
            c.tokenIn.safeTransfer(v, leg.amountIn);
            AnchorVault(v).swap(p.buy, leg.amountIn, address(this));
        } else if (leg.venue == Venue.Uniswap) {
            address a = venue[Venue.Uniswap];
            if (a == address(0)) revert VenueNotSet();
            c.tokenIn.safeTransfer(a, leg.amountIn);
            IVenueAdapter(a).swap(address(c.tokenIn), address(c.tokenOut), leg.amountIn, address(this), leg.data);
        } else {
            address s = venue[Venue.Rfq];
            if (s == address(0)) revert VenueNotSet();
            (RfqQuote memory q, bytes memory sig) = abi.decode(leg.data, (RfqQuote, bytes));
            if (q.stock != p.stock || q.takerBuys != p.buy || q.amountIn != leg.amountIn) revert QuoteMismatch();
            c.tokenIn.safeTransfer(s, leg.amountIn);
            RfqSettlement(s).fill(q, sig, msg.sender, address(this));
        }
        // balance delta is the source of truth, not the venue's return value
        out = c.tokenOut.balanceOf(address(this)) - before;
        if (out == 0) revert ZeroAmount();
    }

    /// @dev buy:  usdIn <= value(out) * (1 + allowed)   sell: usdOut >= value(in) * (1 - allowed)
    function _checkBand(bool buy, uint256 amountIn, uint256 out, Ctx memory c, uint256 i) internal view {
        if (buy) {
            uint256 fairWad = Math.mulDiv(out, c.priceWad, c.stockUnit);
            if (amountIn * usdToWad * Constants.BPS > fairWad * (Constants.BPS + c.allowedBps)) revert OutsideBand(i);
        } else {
            uint256 fairWad = Math.mulDiv(amountIn, c.priceWad, c.stockUnit);
            if (c.allowedBps >= Constants.BPS) return;
            if (out * usdToWad * Constants.BPS < fairWad * (Constants.BPS - c.allowedBps)) revert OutsideBand(i);
        }
    }

    /// @dev USD per whole stock token, WAD, before the protocol fee.
    function _execPrice(bool buy, uint256 amountIn, uint256 out, Ctx memory c) internal view returns (uint256) {
        return buy
            ? Math.mulDiv(amountIn * usdToWad, c.stockUnit, out)
            : Math.mulDiv(out * usdToWad, c.stockUnit, amountIn);
    }
}
