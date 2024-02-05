// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "@solarity/solidity-lib/contracts-registry/AbstractDependant.sol";
import "@solarity/solidity-lib/libs/utils/DecimalsConverter.sol";

import "../interfaces/IDefiCore.sol";
import "../interfaces/IAssetParameters.sol";
import "../interfaces/ISystemParameters.sol";
import "../interfaces/ISystemPoolsRegistry.sol";
import "../interfaces/IBasicPool.sol";
import "../interfaces/IPriceManager.sol";
import "../interfaces/IInterestRateLibrary.sol";

import "../libraries/AnnualRatesConverter.sol";
import "../libraries/MathHelper.sol";

import "../core/Registry.sol";
import "../core/CompoundRateKeeper.sol";

abstract contract AbstractPool is IBasicPool, Initializable, AbstractDependant {
    using SafeERC20 for IERC20;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    uint256 public constant UPDATE_RATE_INTERVAL = 1 hours;

    IDefiCore internal _defiCore;
    IAssetParameters internal _assetParameters;
    ISystemParameters internal _systemParameters;
    ISystemPoolsRegistry internal _systemPoolsRegistry;
    IPriceManager internal _priceManager;
    IInterestRateLibrary internal _interestRateLibrary;

    CompoundRateKeeper public compoundRateKeeper;

    address public override assetAddr;
    bytes32 public override assetKey;

    uint256 public override aggregatedBorrowedAmount;
    uint256 public aggregatedNormalizedBorrowedAmount;
    uint256 public override totalReserves;

    mapping(address => BorrowInfo) public override borrowInfos;
    mapping(address => mapping(address => uint256)) public borrowAllowances;

    modifier onlyDefiCore() {
        require(address(_defiCore) == msg.sender, "AbstractPool: Caller not a DefiCore.");
        _;
    }

    modifier onlySystemPoolsRegistry() {
        require(
            address(_systemPoolsRegistry) == msg.sender,
            "AbstractPool: Caller not a SystemPoolsRegistry."
        );
        _;
    }

    function setDependencies(
        address contractsRegistry_,
        bytes memory
    ) public virtual override dependant {
        IRegistry registry_ = IRegistry(contractsRegistry_);

        _defiCore = IDefiCore(registry_.getDefiCoreContract());
        _assetParameters = IAssetParameters(registry_.getAssetParametersContract());
        _systemParameters = ISystemParameters(registry_.getSystemParametersContract());
        _systemPoolsRegistry = ISystemPoolsRegistry(registry_.getSystemPoolsRegistryContract());
        _priceManager = IPriceManager(registry_.getPriceManagerContract());
        _interestRateLibrary = IInterestRateLibrary(registry_.getInterestRateLibraryContract());
    }

    function approveToBorrow(
        address userAddr_,
        uint256 approveAmount_,
        address delegateeAddr_,
        uint256 currentAllowance_
    ) external override onlyDefiCore {
        require(
            borrowAllowances[userAddr_][delegateeAddr_] == currentAllowance_,
            "AbstractPool: The current allowance is not the same as expected."
        );
        borrowAllowances[userAddr_][delegateeAddr_] = approveAmount_;
    }

    function borrowFor(
        address userAddr_,
        address recipient_,
        uint256 amountToBorrow_
    ) external override onlyDefiCore {
        _borrowFor(userAddr_, recipient_, amountToBorrow_);
    }

    function delegateBorrow(
        address userAddr_,
        address delegatee_,
        uint256 amountToBorrow_
    ) external override onlyDefiCore {
        uint256 borrowAllowance_ = borrowAllowances[userAddr_][delegatee_];

        require(
            borrowAllowance_ >= amountToBorrow_,
            "AbstractPool: Not enough allowed to borrow amount."
        );

        borrowAllowances[userAddr_][delegatee_] = borrowAllowance_ - amountToBorrow_;

        _borrowFor(userAddr_, delegatee_, amountToBorrow_);
    }

    function repayBorrowFor(
        address userAddr_,
        address closureAddr_,
        uint256 repayAmount_,
        bool isMaxRepay_
    ) external payable override onlyDefiCore returns (uint256) {
        RepayBorrowVars memory repayBorrowVars_ = _getRepayBorrowVars(
            userAddr_,
            repayAmount_,
            isMaxRepay_
        );

        _beforeRepayCheck(repayBorrowVars_.repayAmount, closureAddr_);

        if (repayBorrowVars_.currentAbsoluteAmount == 0) {
            return 0;
        }

        BorrowInfo storage borrowInfo = borrowInfos[userAddr_];

        uint256 currentInterest_ = repayBorrowVars_.currentAbsoluteAmount -
            borrowInfo.borrowAmount;

        if (repayBorrowVars_.repayAmount > currentInterest_) {
            borrowInfo.borrowAmount =
                repayBorrowVars_.currentAbsoluteAmount -
                repayBorrowVars_.repayAmount;
            aggregatedBorrowedAmount -= repayBorrowVars_.repayAmount - currentInterest_;
        }

        aggregatedNormalizedBorrowedAmount = MathHelper.getNormalizedAmount(
            aggregatedBorrowedAmount,
            aggregatedNormalizedBorrowedAmount,
            repayBorrowVars_.repayAmount,
            repayBorrowVars_.currentRate,
            false
        );

        borrowInfo.normalizedAmount = MathHelper.getNormalizedAmount(
            borrowInfo.borrowAmount,
            repayBorrowVars_.normalizedAmount,
            repayBorrowVars_.repayAmount,
            repayBorrowVars_.currentRate,
            false
        );

        uint256 reserveFunds_ = Math
            .min(currentInterest_, repayBorrowVars_.repayAmount)
            .mulWithPrecision(_assetParameters.getReserveFactor(assetKey));

        totalReserves += reserveFunds_;

        _repayAssetTokens(repayBorrowVars_.repayAmount, closureAddr_);

        return repayBorrowVars_.repayAmount;
    }

    function withdrawReservedFunds(
        address recipientAddr_,
        uint256 amountToWithdraw_,
        bool isAllFunds_
    ) external override onlySystemPoolsRegistry returns (uint256) {
        uint256 currentReserveAmount_ = totalReserves;

        if (currentReserveAmount_ == 0) {
            return 0;
        }

        if (isAllFunds_) {
            amountToWithdraw_ = currentReserveAmount_;
        } else {
            require(
                amountToWithdraw_ <= currentReserveAmount_,
                "LiquidityPool: Not enough reserved funds."
            );
        }

        totalReserves = currentReserveAmount_ - amountToWithdraw_;

        IERC20(assetAddr).safeTransfer(
            recipientAddr_,
            _convertToUnderlyingAsset(amountToWithdraw_)
        );

        return getAmountInUSD(amountToWithdraw_);
    }

    function updateCompoundRate(bool withInterval_) public override returns (uint256) {
        CompoundRateKeeper _cr = compoundRateKeeper;

        if (withInterval_ && _cr.getLastUpdate() + UPDATE_RATE_INTERVAL > block.timestamp) {
            return _cr.getCurrentRate();
        } else {
            return
                _cr.update(
                    AnnualRatesConverter.convertToRatePerSecond(
                        _interestRateLibrary,
                        getAnnualBorrowRate(),
                        PRECISION
                    )
                );
        }
    }

    function getTotalBorrowedAmount() public view override returns (uint256) {
        /**
         * @dev In this section of code we have an integer division, which loses 1 wei.
         * It is critical in some functions of the system (for example, in exchangeRate when calculating the interest that has accrued in the pool)
         */
        return
            aggregatedNormalizedBorrowedAmount.mulWithPrecision(
                compoundRateKeeper.getCurrentRate()
            ) + 1;
    }

    function getAmountInUSD(uint256 assetAmount_) public view override returns (uint256) {
        return assetAmount_.mulDiv(getAssetPrice(), DECIMAL);
    }

    function getAmountFromUSD(uint256 usdAmount_) public view override returns (uint256) {
        return usdAmount_.mulDiv(DECIMAL, getAssetPrice());
    }

    function getAssetPrice() public view override returns (uint256) {
        (uint256 price_, uint8 currentPriceDecimals_) = _priceManager.getPrice(assetKey);

        return price_.convert(currentPriceDecimals_, PRICE_DECIMALS);
    }

    function getUnderlyingDecimals() public view override returns (uint8) {
        return IERC20Metadata(assetAddr).decimals();
    }

    function getCurrentRate() public view override returns (uint256) {
        return compoundRateKeeper.getCurrentRate();
    }

    function getNewCompoundRate() public view override returns (uint256) {
        return
            compoundRateKeeper.getNewCompoundRate(
                AnnualRatesConverter.convertToRatePerSecond(
                    _interestRateLibrary,
                    getAnnualBorrowRate(),
                    PRECISION
                )
            );
    }

    function getAnnualBorrowRate() public view virtual override returns (uint256);

    function _borrowFor(address userAddr_, address recipient_, uint256 amountToBorrow_) internal {
        uint256 currentRate_ = updateCompoundRate(true);

        _beforeBorrowCheck(amountToBorrow_, userAddr_);

        aggregatedBorrowedAmount += amountToBorrow_;
        aggregatedNormalizedBorrowedAmount = MathHelper.getNormalizedAmount(
            0,
            aggregatedNormalizedBorrowedAmount,
            amountToBorrow_,
            currentRate_,
            true
        );

        BorrowInfo storage borrowInfo = borrowInfos[userAddr_];

        borrowInfo.borrowAmount += amountToBorrow_;
        borrowInfo.normalizedAmount = MathHelper.getNormalizedAmount(
            0,
            borrowInfo.normalizedAmount,
            amountToBorrow_,
            currentRate_,
            true
        );

        _borrowAssetTokens(amountToBorrow_, recipient_);
    }

    function _getRepayBorrowVars(
        address userAddr_,
        uint256 repayAmount_,
        bool isMaxRepay_
    ) internal returns (RepayBorrowVars memory repayBorrowVars_) {
        repayBorrowVars_.userAddr = userAddr_;
        repayBorrowVars_.currentRate = updateCompoundRate(false);
        repayBorrowVars_.normalizedAmount = borrowInfos[userAddr_].normalizedAmount;
        repayBorrowVars_.currentAbsoluteAmount = repayBorrowVars_
            .normalizedAmount
            .mulWithPrecision(repayBorrowVars_.currentRate);

        if (isMaxRepay_) {
            uint256 userBalance_ = _convertFromUnderlyingAsset(
                IERC20(assetAddr).balanceOf(userAddr_)
            );

            if (assetKey == _systemPoolsRegistry.nativeAssetKey()) {
                userBalance_ += msg.value;
            }

            repayBorrowVars_.repayAmount = Math.min(
                userBalance_,
                repayBorrowVars_.currentAbsoluteAmount
            );

            require(
                repayBorrowVars_.repayAmount > 0,
                "AbstractPool: Repay amount cannot be a zero."
            );
        } else {
            repayBorrowVars_.repayAmount = Math.min(
                repayBorrowVars_.currentAbsoluteAmount,
                repayAmount_
            );
        }
    }

    function _abstractPoolInitialize(
        address assetAddr_,
        bytes32 assetKey_
    ) internal onlyInitializing {
        compoundRateKeeper = new CompoundRateKeeper();

        assetAddr = assetAddr_;
        assetKey = assetKey_;
    }

    function _borrowAssetTokens(uint256 amountToBorrow_, address recipient_) internal virtual;

    function _repayAssetTokens(uint256 repayAmount_, address payerAddr_) internal virtual;

    function _beforeBorrowCheck(uint256 amountToBorrow_, address borrowerAddr_) internal virtual {}

    function _beforeRepayCheck(uint256 repayAmount_, address payerAddr_) internal virtual {}

    function _convertToUnderlyingAsset(
        uint256 amountToConvert_
    ) internal view returns (uint256 assetAmount_) {
        assetAmount_ = amountToConvert_.from18(getUnderlyingDecimals());

        require(assetAmount_ > 0, "AbstractPool: Incorrect asset amount after conversion.");
    }

    function _convertFromUnderlyingAsset(
        uint256 amountToConvert_
    ) internal view returns (uint256 assetAmount_) {
        return amountToConvert_.to18(getUnderlyingDecimals());
    }
}
