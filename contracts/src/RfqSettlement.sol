// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RfqQuote, Constants} from "./libraries/Types.sol";
import {ParamController} from "./ParamController.sol";
import {
    ZeroAddress,
    NotRouter,
    NotMaker,
    NotGuardian,
    WrongTaker,
    QuoteExpired,
    NonceUsed,
    BadSignature,
    MarketPaused,
    RfqSizeOutOfRange
} from "./libraries/Errors.sol";

/// @notice Settles EIP-712 quotes signed by allowlisted market makers. Called only by the SwapRouter,
/// which has already sent the taker's input here. Makers approve this contract for what they pay out.
/// The RFQ fee (rfqFeeBps of the USDG side) is paid by the maker, so the taker gets exactly amountOut.
contract RfqSettlement is Ownable, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "RfqQuote(address maker,address taker,address stock,bool takerBuys,uint256 amountIn,uint256 amountOut,uint256 nonce,uint256 expiry)"
    );

    address public immutable router;
    ParamController public immutable params;
    IERC20 public immutable usdg;
    address public immutable feeCollector;
    uint256 public immutable usdToWad;

    mapping(address => bool) public isMaker;
    mapping(address maker => mapping(uint256 nonce => bool)) public nonceUsed;

    event MakerSet(address indexed maker, bool on);
    event NonceCancelled(address indexed maker, uint256 nonce);
    event RfqFilled(
        bytes32 indexed quoteHash,
        address indexed maker,
        address indexed taker,
        address stock,
        bool takerBuys,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    constructor(address owner_, address router_, address params_, address usdg_, address feeCollector_)
        Ownable(owner_)
        EIP712("Paritas RFQ", "1")
    {
        if (router_ == address(0) || params_ == address(0) || usdg_ == address(0) || feeCollector_ == address(0)) {
            revert ZeroAddress();
        }
        router = router_;
        params = ParamController(params_);
        usdg = IERC20(usdg_);
        feeCollector = feeCollector_;
        usdToWad = 10 ** (18 - IERC20Metadata(usdg_).decimals());
    }

    function hashQuote(RfqQuote memory q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    q.maker,
                    q.taker,
                    q.stock,
                    q.takerBuys,
                    q.amountIn,
                    q.amountOut,
                    q.nonce,
                    q.expiry
                )
            )
        );
    }

    function fill(RfqQuote calldata q, bytes calldata signature, address taker, address to)
        external
        nonReentrant
        returns (uint256)
    {
        if (msg.sender != router) revert NotRouter();
        if (!isMaker[q.maker]) revert NotMaker();
        if (q.taker != taker) revert WrongTaker();
        if (block.timestamp > q.expiry) revert QuoteExpired();
        if (nonceUsed[q.maker][q.nonce]) revert NonceUsed();
        if (!params.isActive(q.stock)) revert MarketPaused();

        bytes32 h = hashQuote(q);
        if (!SignatureChecker.isValidSignatureNow(q.maker, h, signature)) revert BadSignature();
        nonceUsed[q.maker][q.nonce] = true;

        uint256 usdSide = q.takerBuys ? q.amountIn : q.amountOut;
        uint256 notionalWad = usdSide * usdToWad;
        if (
            notionalWad < uint256(params.rfqMinUsd()) * Constants.WAD
                || notionalWad > uint256(params.rfqMaxUsd()) * Constants.WAD
        ) revert RfqSizeOutOfRange(notionalWad);
        uint256 fee = usdSide * params.rfqFeeBps() / Constants.BPS;

        IERC20 stock = IERC20(q.stock);
        if (q.takerBuys) {
            usdg.safeTransfer(q.maker, q.amountIn - fee);
            if (fee > 0) usdg.safeTransfer(feeCollector, fee);
            stock.safeTransferFrom(q.maker, to, q.amountOut);
        } else {
            stock.safeTransfer(q.maker, q.amountIn);
            usdg.safeTransferFrom(q.maker, to, q.amountOut);
            if (fee > 0) usdg.safeTransferFrom(q.maker, feeCollector, fee);
        }
        emit RfqFilled(h, q.maker, taker, q.stock, q.takerBuys, q.amountIn, q.amountOut, fee);
        return q.amountOut;
    }

    function cancelNonces(uint256[] calldata nonces) external {
        for (uint256 i; i < nonces.length; ++i) {
            nonceUsed[msg.sender][nonces[i]] = true;
            emit NonceCancelled(msg.sender, nonces[i]);
        }
    }

    function setMaker(address maker, bool on) external onlyOwner {
        isMaker[maker] = on;
        emit MakerSet(maker, on);
    }

    /// @notice The guardian can remove a maker immediately (restrictive only).
    function removeMaker(address maker) external {
        if (msg.sender != params.guardian() && msg.sender != owner()) revert NotGuardian();
        isMaker[maker] = false;
        emit MakerSet(maker, false);
    }
}
