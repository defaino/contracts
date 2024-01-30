// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "@solarity/solidity-lib/contracts-registry/AbstractDependant.sol";

import "../interfaces/IPRT.sol";
import "../interfaces/IRegistry.sol";
import "../interfaces/IDefiCore.sol";
import "../interfaces/IUserInfoRegistry.sol";

import "../common/Globals.sol";

contract PRT is IPRT, ERC721Upgradeable, AbstractDependant, ReentrancyGuardUpgradeable {
    uint256 internal _tokenIdCounter;
    address internal _systemOwnerAddr;
    IDefiCore internal _defiCore;
    IUserInfoRegistry internal _userInfoRegistry;

    PRTParams internal _prtParams;

    modifier onlySystemOwner() {
        require(msg.sender == _systemOwnerAddr, "PRT: Only system owner can call this function");
        _;
    }

    function prtInitialize(
        string calldata name_,
        string calldata symbol_,
        PRTParams calldata prtParams_
    ) external initializer {
        __ERC721_init(name_, symbol_);
        __ReentrancyGuard_init();
        _prtParams = prtParams_;
    }

    function setDependencies(address contractsRegistry_, bytes memory) public override dependant {
        IRegistry registry_ = IRegistry(contractsRegistry_);

        _systemOwnerAddr = registry_.getSystemOwner();
        _defiCore = IDefiCore(registry_.getDefiCoreContract());
        _userInfoRegistry = IUserInfoRegistry(registry_.getUserInfoRegistryContract());
    }

    function updatePRTParams(PRTParams calldata prtParams_) external override onlySystemOwner {
        _prtParams = prtParams_;
    }

    function getPRTParams() external view override returns (PRTParams memory) {
        return _prtParams;
    }

    function hasValidPRT(address owner_) public view virtual override returns (bool) {
        IUserInfoRegistry.StatsForPRT memory userStats_ = _userInfoRegistry.getUserPRTStats(
            owner_
        );

        return userStats_.liquidationsNum == 0 && balanceOf(owner_) > 0;
    }

    function mintPRT() public override nonReentrant {
        require(balanceOf(msg.sender) == 0, "PRT: user has already minted a PRT token");
        IUserInfoRegistry.StatsForPRT memory userStats_ = _userInfoRegistry.getUserPRTStats(
            msg.sender
        );

        _checkUserPRTStats(
            msg.sender,
            userStats_.supplyStats,
            _defiCore.getTotalSupplyBalanceInUSD,
            _prtParams.supplyParams
        );

        _checkUserPRTStats(
            msg.sender,
            userStats_.borrowStats,
            _defiCore.getTotalBorrowBalanceInUSD,
            _prtParams.borrowParams
        );

        require(
            userStats_.repaysNum > 0,
            "PRT: can't mint PRT since the user hasn't ever used the repay function"
        );
        require(
            userStats_.liquidationsNum == 0,
            "PRT: can't mint PRT because the user has been liquidated"
        );

        _safeMint(msg.sender, _tokenIdCounter++);
    }

    function burn(uint256 tokenId_) external override {
        require(
            _ownerOf(tokenId_) == msg.sender,
            "PRT: the caller isn't an owner of the token with a such id"
        );
        _burn(tokenId_);
    }

    function _checkUserPRTStats(
        address userAddr_,
        IUserInfoRegistry.LastSavedUserPosition memory userPosition_,
        function(address) external view returns (uint256) getUserCurrentUSDAmount_,
        PositionParams storage positionRequirements_
    ) internal virtual {
        require(userPosition_.timestamp != 0, "PRT: No eligible action found");
        require(
            userPosition_.timestamp + positionRequirements_.minTimeAfter <= block.timestamp,
            "PRT: Not enough time since the eligible action"
        );
        require(
            getUserCurrentUSDAmount_(userAddr_) >= positionRequirements_.minAmountInUSD,
            "PRT: The user USD amount is lower than the minimum required"
        );
    }

    function _beforeTokenTransfer(
        address from_,
        address to_,
        uint256 firstTokenId_,
        uint256 batchSize_
    ) internal virtual override {
        require(from_ == address(0) || to_ == address(0), "PRT: PRT token is non-transferrable");
        super._beforeTokenTransfer(from_, to_, firstTokenId_, batchSize_);
    }
}
