// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";
import "@dlsl/dev-modules/libs/decimals/DecimalsConverter.sol";

import "../interfaces/IDefiCore.sol";
import "../interfaces/IAssetParameters.sol";
import "../interfaces/ISystemParameters.sol";
import "../interfaces/ISystemPoolsRegistry.sol";
import "../interfaces/IBasicPool.sol";
import "../interfaces/IPriceManager.sol";
import "../interfaces/IInterestRateLibrary.sol";

import "../libraries/AnnualRatesConverter.sol";
import "../libraries/MathHelper.sol";

import "../Registry.sol";
import "../CompoundRateKeeper.sol";

abstract contract AbstractPool is IBasicPool, Initializable, AbstractDependant {
    using SafeERC20 for IERC20;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    uint256 public constant UPDATE_RATE_INTERVAL = 1 hours;

    IDefiCore internal defiCore;
    IAssetParameters internal assetParameters;
    ISystemParameters internal systemParameters;
    ISystemPoolsRegistry internal systemPoolsRegistry;
    IPriceManager internal priceManager;
    IInterestRateLibrary internal interestRateLibrary;

    CompoundRateKeeper public compoundRateKeeper;

    address public override assetAddr;
    bytes32 public override assetKey;

    uint256 public override aggregatedBorrowedAmount;
    uint256 public aggregatedNormalizedBorrowedAmount;
    uint256 public override totalReserves;

    mapping(address => BorrowInfo) public override borrowInfos;
    mapping(address => mapping(address => uint256)) public borrowAllowances;

    modifier onlyDefiCore() {
        require(address(defiCore) == msg.sender, "AbstractPool: Caller not a DefiCore.");
        _;
    }

    modifier onlySystemPoolsRegistry() {
        require(
            address(systemPoolsRegistry) == msg.sender,
            "AbstractPool: Caller not a SystemPoolsRegistry."
        );
        _;
    }

    function setDependencies(address _contractsRegistry) public virtual override dependant {
        IRegistry _registry = IRegistry(_contractsRegistry);

        defiCore = IDefiCore(_registry.getDefiCoreContract());
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        systemParameters = ISystemParameters(_registry.getSystemParametersContract());
        systemPoolsRegistry = ISystemPoolsRegistry(_registry.getSystemPoolsRegistryContract());
        priceManager = IPriceManager(_registry.getPriceManagerContract());
        interestRateLibrary = IInterestRateLibrary(_registry.getInterestRateLibraryContract());
    }

    function approveToBorrow(
        address _userAddr,
        uint256 _approveAmount,
        address _delegateeAddr,
        uint256 _currentAllowance
    ) external override onlyDefiCore {
        require(
            borrowAllowances[_userAddr][_delegateeAddr] == _currentAllowance,
            "AbstractPool: The current allowance is not the same as expected."
        );
        borrowAllowances[_userAddr][_delegateeAddr] = _approveAmount;
    }

    function borrowFor(
        address _userAddr,
        address _recipient,
        uint256 _amountToBorrow
    ) external override onlyDefiCore {
        _borrowFor(_userAddr, _recipient, _amountToBorrow);
    }

    function delegateBorrow(
        address _userAddr,
        address _delegatee,
        uint256 _amountToBorrow
    ) external override onlyDefiCore {
        uint256 borrowAllowance = borrowAllowances[_userAddr][_delegatee];

        require(
            borrowAllowance >= _amountToBorrow,
            "AbstractPool: Not enough allowed to borrow amount."
        );

        borrowAllowances[_userAddr][_delegatee] = borrowAllowance - _amountToBorrow;

        _borrowFor(_userAddr, _delegatee, _amountToBorrow);
    }

    function repayBorrowFor(
        address _userAddr,
        address _closureAddr,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) external payable override onlyDefiCore returns (uint256) {
        RepayBorrowVars memory _repayBorrowVars = _getRepayBorrowVars(
            _userAddr,
            _repayAmount,
            _isMaxRepay
        );

        _beforeRepayCheck(_repayBorrowVars.repayAmount, _closureAddr);

        if (_repayBorrowVars.currentAbsoluteAmount == 0) {
            return 0;
        }

        BorrowInfo storage borrowInfo = borrowInfos[_userAddr];

        uint256 _currentInterest = _repayBorrowVars.currentAbsoluteAmount -
            borrowInfo.borrowAmount;

        if (_repayBorrowVars.repayAmount > _currentInterest) {
            borrowInfo.borrowAmount =
                _repayBorrowVars.currentAbsoluteAmount -
                _repayBorrowVars.repayAmount;
            aggregatedBorrowedAmount -= _repayBorrowVars.repayAmount - _currentInterest;
        }

        aggregatedNormalizedBorrowedAmount = MathHelper.getNormalizedAmount(
            aggregatedBorrowedAmount,
            aggregatedNormalizedBorrowedAmount,
            _repayBorrowVars.repayAmount,
            _repayBorrowVars.currentRate,
            false
        );

        borrowInfo.normalizedAmount = MathHelper.getNormalizedAmount(
            borrowInfo.borrowAmount,
            _repayBorrowVars.normalizedAmount,
            _repayBorrowVars.repayAmount,
            _repayBorrowVars.currentRate,
            false
        );

        uint256 _reserveFunds = Math
            .min(_currentInterest, _repayBorrowVars.repayAmount)
            .mulWithPrecision(assetParameters.getReserveFactor(assetKey));

        totalReserves += _reserveFunds;

        _repayAssetTokens(_repayBorrowVars.repayAmount, _closureAddr);

        return _repayBorrowVars.repayAmount;
    }

    function withdrawReservedFunds(
        address _recipientAddr,
        uint256 _amountToWithdraw,
        bool _isAllFunds
    ) external override onlySystemPoolsRegistry returns (uint256) {
        uint256 _currentReserveAmount = totalReserves;

        if (_currentReserveAmount == 0) {
            return 0;
        }

        if (_isAllFunds) {
            _amountToWithdraw = _currentReserveAmount;
        } else {
            require(
                _amountToWithdraw <= _currentReserveAmount,
                "LiquidityPool: Not enough reserved funds."
            );
        }

        totalReserves = _currentReserveAmount - _amountToWithdraw;

        IERC20(assetAddr).safeTransfer(
            _recipientAddr,
            _convertToUnderlyingAsset(_amountToWithdraw)
        );

        return getAmountInUSD(_amountToWithdraw);
    }

    function updateCompoundRate(bool _withInterval) public override returns (uint256) {
        CompoundRateKeeper _cr = compoundRateKeeper;

        if (_withInterval && _cr.getLastUpdate() + UPDATE_RATE_INTERVAL > block.timestamp) {
            return _cr.getCurrentRate();
        } else {
            return
                _cr.update(
                    AnnualRatesConverter.convertToRatePerSecond(
                        interestRateLibrary,
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

    function getAmountInUSD(uint256 _assetAmount) public view override returns (uint256) {
        return _assetAmount.mulDiv(getAssetPrice(), DECIMAL);
    }

    function getAmountFromUSD(uint256 _usdAmount) public view override returns (uint256) {
        return _usdAmount.mulDiv(DECIMAL, getAssetPrice());
    }

    function getAssetPrice() public view override returns (uint256) {
        (uint256 _price, uint8 _currentPriceDecimals) = priceManager.getPrice(assetKey);

        return _price.convert(_currentPriceDecimals, PRICE_DECIMALS);
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
                    interestRateLibrary,
                    getAnnualBorrowRate(),
                    PRECISION
                )
            );
    }

    function getAnnualBorrowRate() public view virtual override returns (uint256);

    function _borrowFor(address _userAddr, address _recipient, uint256 _amountToBorrow) internal {
        uint256 _currentRate = updateCompoundRate(true);

        _beforeBorrowCheck(_amountToBorrow, _userAddr);

        aggregatedBorrowedAmount += _amountToBorrow;
        aggregatedNormalizedBorrowedAmount = MathHelper.getNormalizedAmount(
            0,
            aggregatedNormalizedBorrowedAmount,
            _amountToBorrow,
            _currentRate,
            true
        );

        BorrowInfo storage borrowInfo = borrowInfos[_userAddr];

        borrowInfo.borrowAmount += _amountToBorrow;
        borrowInfo.normalizedAmount = MathHelper.getNormalizedAmount(
            0,
            borrowInfo.normalizedAmount,
            _amountToBorrow,
            _currentRate,
            true
        );

        _borrowAssetTokens(_amountToBorrow, _recipient);
    }

    function _getRepayBorrowVars(
        address _userAddr,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) internal returns (RepayBorrowVars memory _repayBorrowVars) {
        _repayBorrowVars.userAddr = _userAddr;
        _repayBorrowVars.currentRate = updateCompoundRate(false);
        _repayBorrowVars.normalizedAmount = borrowInfos[_userAddr].normalizedAmount;
        _repayBorrowVars.currentAbsoluteAmount = _repayBorrowVars
            .normalizedAmount
            .mulWithPrecision(_repayBorrowVars.currentRate);

        if (_isMaxRepay) {
            uint256 _userBalance = _convertFromUnderlyingAsset(
                IERC20(assetAddr).balanceOf(_userAddr)
            );

            if (assetKey == systemPoolsRegistry.nativeAssetKey()) {
                _userBalance += msg.value;
            }

            _repayBorrowVars.repayAmount = Math.min(
                _userBalance,
                _repayBorrowVars.currentAbsoluteAmount
            );

            require(
                _repayBorrowVars.repayAmount > 0,
                "AbstractPool: Repay amount cannot be a zero."
            );
        } else {
            _repayBorrowVars.repayAmount = Math.min(
                _repayBorrowVars.currentAbsoluteAmount,
                _repayAmount
            );
        }
    }

    function _abstractPoolInitialize(
        address _assetAddr,
        bytes32 _assetKey
    ) internal onlyInitializing {
        compoundRateKeeper = new CompoundRateKeeper();
        assetAddr = _assetAddr;
        assetKey = _assetKey;
    }

    function _borrowAssetTokens(uint256 _amountToBorrow, address _recipient) internal virtual;

    function _repayAssetTokens(uint256 _repayAmount, address _payerAddr) internal virtual;

    function _beforeBorrowCheck(uint256 _amountToBorrow, address _borrowerAddr) internal virtual {}

    function _beforeRepayCheck(uint256 _repayAmount, address _payerAddr) internal virtual {}

    function _convertToUnderlyingAsset(
        uint256 _amountToConvert
    ) internal view returns (uint256 _assetAmount) {
        _assetAmount = _amountToConvert.from18(getUnderlyingDecimals());

        require(_assetAmount > 0, "AbstractPool: Incorrect asset amount after conversion.");
    }

    function _convertFromUnderlyingAsset(
        uint256 _amountToConvert
    ) internal view returns (uint256 _assetAmount) {
        return _amountToConvert.to18(getUnderlyingDecimals());
    }
}
