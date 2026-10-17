// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AnchorVault} from "./AnchorVault.sol";
import {ParamController} from "./ParamController.sol";
import {ZeroAddress, AlreadySet, MarketNotListed, VenueNotSet} from "./libraries/Errors.sol";

/// @notice Deploys one AnchorVault per listed stock token (CREATE2, salt = stock address).
contract VaultFactory is Ownable {
    address public immutable usdg;
    address public immutable params;
    address public immutable oracle;
    address public immutable sessions;
    address public immutable eligibility;
    address public immutable feeCollector;
    address public router; // set once, right after the router is deployed

    mapping(address stock => address vault) public vaultOf;
    address[] public allVaults;

    event RouterSet(address router);
    event VaultCreated(address indexed stock, address vault);

    constructor(
        address owner_,
        address usdg_,
        address params_,
        address oracle_,
        address sessions_,
        address eligibility_,
        address feeCollector_
    ) Ownable(owner_) {
        if (
            usdg_ == address(0) || params_ == address(0) || oracle_ == address(0) || sessions_ == address(0)
                || eligibility_ == address(0) || feeCollector_ == address(0)
        ) revert ZeroAddress();
        usdg = usdg_;
        params = params_;
        oracle = oracle_;
        sessions = sessions_;
        eligibility = eligibility_;
        feeCollector = feeCollector_;
    }

    function setRouter(address r) external onlyOwner {
        if (router != address(0)) revert AlreadySet();
        if (r == address(0)) revert ZeroAddress();
        router = r;
        emit RouterSet(r);
    }

    function createVault(address stock) external onlyOwner returns (address vault) {
        if (router == address(0)) revert VenueNotSet();
        if (vaultOf[stock] != address(0)) revert AlreadySet();
        if (!ParamController(params).market(stock).listed) revert MarketNotListed();
        vault = address(
            new AnchorVault{salt: bytes32(uint256(uint160(stock)))}(
                AnchorVault.Init(stock, usdg, params, oracle, sessions, eligibility, router, feeCollector)
            )
        );
        vaultOf[stock] = vault;
        allVaults.push(vault);
        emit VaultCreated(stock, vault);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
