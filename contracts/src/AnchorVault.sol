// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Session, TierParams, SessionParams, Constants} from "./libraries/Types.sol";
import {VaultMath} from "./libraries/VaultMath.sol";
import {ParamController} from "./ParamController.sol";
import {OracleRouter} from "./OracleRouter.sol";
import {SessionController} from "./SessionController.sol";
import {EligibilityRegistry} from "./EligibilityRegistry.sol";
import {
    NotRouter,
    ZeroAmount,
    ZeroAddress,
    MarketPaused,
    VaultClosed,
    AboveClip,
    InsufficientInventory,
    AboveCap,
    SlippageExceeded,
    NotEligible
} from "./libraries/Errors.sol";

/// @notice One vault per stock token. Holds the stock token and USDG, quotes around the Chainlink price,
/// and only the SwapRouter can trade against it. LP shares are this ERC-20.
///
/// Guarantees (tested in test/AnchorVault.t.sol and test/Invariants.t.sol):
///  - never sells below or buys above the oracle price (cost is floored at zero)
///  - closed when the session is Closed, the market or protocol is paused, the oracle is stale,
///    or the issuer flags oraclePaused()
///  - withdrawals to yourself always work: no oracle, no pause, no session check, paid in kind
///  - reserves are tracked internally, so donations cannot move the share price
contract AnchorVault is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_LIQUIDITY = 1e3;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable stock;
    IERC20 public immutable usdg;
    ParamController public immutable params;
    OracleRouter public immutable oracle;
    SessionController public immutable sessions;
    EligibilityRegistry public immutable eligibility;
    address public immutable router;
    address public immutable feeCollector;
    uint256 public immutable stockUnit;
    uint256 public immutable usdToWad;

    uint256 public reserveStock;
    uint256 public reserveUsd;

    struct Init {
        address stock;
        address usdg;
        address params;
        address oracle;
        address sessions;
        address eligibility;
        address router;
        address feeCollector;
    }

    event Swap(
        bool indexed buy,
        uint256 amountIn,
        uint256 amountOut,
        uint256 oraclePriceWad,
        uint256 costWad,
        uint256 spreadShare,
        uint8 session
    );
    event Deposit(
        address indexed sender, address indexed receiver, uint256 usdIn, uint256 stockIn, uint256 shares, uint256 valueWad
    );
    event Withdraw(address indexed owner, address indexed receiver, uint256 shares, uint256 usdOut, uint256 stockOut);
    event Sync(uint256 reserveStock, uint256 reserveUsd);

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    constructor(Init memory i)
        ERC20(
            string.concat("Paritas Vault ", IERC20Metadata(i.stock).symbol()),
            string.concat("pv", IERC20Metadata(i.stock).symbol())
        )
    {
        if (
            i.stock == address(0) || i.usdg == address(0) || i.params == address(0) || i.oracle == address(0)
                || i.sessions == address(0) || i.eligibility == address(0) || i.router == address(0)
                || i.feeCollector == address(0)
        ) revert ZeroAddress();
        stock = IERC20(i.stock);
        usdg = IERC20(i.usdg);
        params = ParamController(i.params);
        oracle = OracleRouter(i.oracle);
        sessions = SessionController(i.sessions);
        eligibility = EligibilityRegistry(i.eligibility);
        router = i.router;
        feeCollector = i.feeCollector;
        stockUnit = 10 ** IERC20Metadata(i.stock).decimals();
        uint8 ud = IERC20Metadata(i.usdg).decimals();
        require(ud <= 18, "usd decimals");
        usdToWad = 10 ** (18 - ud);
    }

    // ---------------------------------------------------------------- views

    /// @notice Everything the API needs to quote this vault off-chain with packages/shared quote.ts.
    function state()
        external
        view
        returns (
            uint256 priceWad,
            uint256 rStock,
            uint256 rUsd,
            Session session,
            TierParams memory tierParams,
            SessionParams memory sessionParams,
            bool open
        )
    {
        session = sessions.current();
        sessionParams = params.sessionParams(session);
        tierParams = params.tierOf(address(stock));
        (priceWad,) = oracle.price(address(stock));
        rStock = reserveStock;
        rUsd = reserveUsd;
        open = sessionParams.vaultOpen && params.isActive(address(stock));
    }

    function previewSwap(bool buy, uint256 amountIn) external view returns (VaultMath.Result memory r) {
        (r,,) = _quote(buy, amountIn);
    }

    function previewDeposit(uint256 usdIn, uint256 stockIn) external view returns (uint256 shares, uint256 valueWad) {
        (shares, valueWad,) = _previewDeposit(usdIn, stockIn);
    }

    function previewWithdraw(uint256 shares) public view returns (uint256 usdOut, uint256 stockOut) {
        uint256 supply = totalSupply();
        if (supply == 0) return (0, 0);
        usdOut = reserveUsd * shares / supply;
        stockOut = reserveStock * shares / supply;
    }

    /// @notice NAV in USD (WAD) at the current oracle price. For display; reverts if the feed is broken.
    function navWad() external view returns (uint256) {
        (uint256 p,) = oracle.price(address(stock));
        return VaultMath.navWad(_pool(p));
    }

    // ---------------------------------------------------------------- trading (router only)

    /// @notice The router has already transferred the input token. amountIn = balance - reserve.
    function swap(bool buy, address to) external onlyRouter nonReentrant returns (uint256 amountOut) {
        uint256 amountIn = buy ? usdg.balanceOf(address(this)) - reserveUsd : stock.balanceOf(address(this)) - reserveStock;
        if (amountIn == 0) revert ZeroAmount();
        (VaultMath.Result memory r, uint256 priceWad, Session s) = _quote(buy, amountIn);
        amountOut = r.amountOut;
        if (amountOut == 0) revert ZeroAmount();

        if (buy) {
            if (amountOut > reserveStock) revert InsufficientInventory();
            reserveUsd += amountIn - r.spreadShare;
            reserveStock -= amountOut;
            stock.safeTransfer(to, amountOut);
        } else {
            if (amountOut + r.spreadShare > reserveUsd) revert InsufficientInventory();
            reserveStock += amountIn;
            reserveUsd -= amountOut + r.spreadShare;
            usdg.safeTransfer(to, amountOut);
        }
        if (r.spreadShare > 0) usdg.safeTransfer(feeCollector, r.spreadShare);
        emit Swap(buy, amountIn, amountOut, priceWad, r.costWad, r.spreadShare, uint8(s));
        emit Sync(reserveStock, reserveUsd);
    }

    // ---------------------------------------------------------------- liquidity

    function deposit(uint256 usdIn, uint256 stockIn, uint256 minShares, address receiver)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (usdIn == 0 && stockIn == 0) revert ZeroAmount();
        if (!eligibility.isEligible(msg.sender)) revert NotEligible(msg.sender);
        if (!eligibility.isEligible(receiver)) revert NotEligible(receiver);

        uint256 valueWad;
        uint256 priceWad;
        (shares, valueWad, priceWad) = _previewDeposit(usdIn, stockIn);

        TierParams memory t = params.tierOf(address(stock));
        if (VaultMath.navWad(_pool(priceWad)) + valueWad > uint256(t.capUsd) * Constants.WAD) revert AboveCap();

        if (totalSupply() == 0) {
            if (shares <= MIN_LIQUIDITY) revert ZeroAmount();
            shares -= MIN_LIQUIDITY;
            _mint(DEAD, MIN_LIQUIDITY);
        }
        if (shares == 0 || shares < minShares) revert SlippageExceeded();

        if (usdIn > 0) usdg.safeTransferFrom(msg.sender, address(this), usdIn);
        if (stockIn > 0) stock.safeTransferFrom(msg.sender, address(this), stockIn);
        reserveUsd += usdIn;
        reserveStock += stockIn;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, usdIn, stockIn, shares, valueWad);
        emit Sync(reserveStock, reserveUsd);
    }

    /// @notice Pro-rata, in kind. Works during pauses, weekends and oracle outages.
    function withdraw(uint256 shares, uint256 minUsd, uint256 minStock, address receiver)
        external
        nonReentrant
        returns (uint256 usdOut, uint256 stockOut)
    {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        if (receiver != msg.sender && !eligibility.isEligible(receiver)) revert NotEligible(receiver);
        (usdOut, stockOut) = previewWithdraw(shares);
        if (usdOut < minUsd || stockOut < minStock) revert SlippageExceeded();
        _burn(msg.sender, shares);
        reserveUsd -= usdOut;
        reserveStock -= stockOut;
        if (usdOut > 0) usdg.safeTransfer(receiver, usdOut);
        if (stockOut > 0) stock.safeTransfer(receiver, stockOut);
        emit Withdraw(msg.sender, receiver, shares, usdOut, stockOut);
        emit Sync(reserveStock, reserveUsd);
    }

    // ---------------------------------------------------------------- internal

    function _pool(uint256 priceWad) internal view returns (VaultMath.Pool memory) {
        return VaultMath.Pool(priceWad, reserveStock, reserveUsd, stockUnit, usdToWad);
    }

    /// @dev Shared by swap and previewSwap so the preview is exactly what executes.
    function _quote(bool buy, uint256 amountIn)
        internal
        view
        returns (VaultMath.Result memory r, uint256 priceWad, Session s)
    {
        (SessionParams memory sp, TierParams memory t, Session sess) = _openContext();
        s = sess;
        priceWad = oracle.vaultPrice(address(stock), params.vaultMaxOracleAge());
        VaultMath.Pricing memory q = VaultMath.Pricing(t.halfSpreadBps, t.skewBps, sp.spreadMulBps, params.spreadShareBps());
        r = VaultMath.quote(_pool(priceWad), q, buy, amountIn);
        uint256 clipWad = uint256(t.clipUsd) * Constants.WAD * sp.clipMulBps / Constants.BPS;
        if (r.notionalWad > clipWad) revert AboveClip(r.notionalWad, clipWad);
    }

    function _previewDeposit(uint256 usdIn, uint256 stockIn)
        internal
        view
        returns (uint256 shares, uint256 valueWad, uint256 priceWad)
    {
        (SessionParams memory sp, TierParams memory t,) = _openContext();
        priceWad = oracle.vaultPrice(address(stock), params.vaultMaxOracleAge());
        VaultMath.Pricing memory q = VaultMath.Pricing(t.halfSpreadBps, t.skewBps, sp.spreadMulBps, 0);
        (shares, valueWad) = VaultMath.depositShares(_pool(priceWad), q, usdIn, stockIn, totalSupply());
    }

    function _openContext() internal view returns (SessionParams memory sp, TierParams memory t, Session s) {
        if (!params.isActive(address(stock))) revert MarketPaused();
        s = sessions.current();
        sp = params.sessionParams(s);
        if (!sp.vaultOpen) revert VaultClosed();
        t = params.tierOf(address(stock));
    }

    /// @dev Vault shares are a claim on stock tokens, so they only move between eligible wallets.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && to != DEAD) {
            if (!eligibility.isEligible(to)) revert NotEligible(to);
        }
        super._update(from, to, value);
    }
}
