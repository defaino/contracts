// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import "./abstract/AbstractDependant.sol";
import "./common/Upgrader.sol";

contract Registry is AccessControl {
    Upgrader private immutable upgrader;

    mapping(bytes32 => address) private _contracts;
    mapping(address => bool) private _isProxy;

    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");

    bytes32 public constant SYSTEM_PARAMETERS_NAME = keccak256("SYSTEM_PARAMETERS");
    bytes32 public constant ASSET_PARAMETERS_NAME = keccak256("ASSET_PARAMETERS");
    bytes32 public constant DEFI_CORE_NAME = keccak256("DEFI_CORE");
    bytes32 public constant INTEREST_RATE_LIBRARY_NAME = keccak256("INTEREST_RATE_LIBRARY");
    bytes32 public constant LIQUIDITY_POOL_FACTORY_NAME = keccak256("LIQUIDITY_POOL_FACTORY");
    bytes32 public constant GOVERNANCE_TOKEN_NAME = keccak256("GOVERNANCE_TOKEN");
    bytes32 public constant REWARDS_DISTRIBUTION_NAME = keccak256("REWARDS_DISTRIBUTION");
    bytes32 public constant PRICE_MANAGER_NAME = keccak256("PRICE_MANAGER");
    bytes32 public constant LIQUIDITY_POOL_REGISTRY_NAME = keccak256("LIQUIDITY_POOL_REGISTRY");
    bytes32 public constant USER_INFO_REGISTRY_NAME = keccak256("USER_INFO_REGISTRY");

    event ContractAdded(bytes32 _name, address _contractAddress);
    event ProxyContractAdded(bytes32 _name, address _proxyAddress, address _implAddress);

    modifier onlyAdmin() {
        require(hasRole(REGISTRY_ADMIN_ROLE, msg.sender), "Registry: Caller is not an admin");
        _;
    }

    constructor() {
        _setupRole(REGISTRY_ADMIN_ROLE, msg.sender);
        _setRoleAdmin(REGISTRY_ADMIN_ROLE, REGISTRY_ADMIN_ROLE);

        upgrader = new Upgrader();
    }

    function getSystemParametersContract() external view returns (address) {
        return getContract(SYSTEM_PARAMETERS_NAME);
    }

    function getAssetParametersContract() external view returns (address) {
        return getContract(ASSET_PARAMETERS_NAME);
    }

    function getDefiCoreContract() external view returns (address) {
        return getContract(DEFI_CORE_NAME);
    }

    function getInterestRateLibraryContract() external view returns (address) {
        return getContract(INTEREST_RATE_LIBRARY_NAME);
    }

    function getLiquidityPoolFactoryContract() external view returns (address) {
        return getContract(LIQUIDITY_POOL_FACTORY_NAME);
    }

    function getGovernanceTokenContract() external view returns (address) {
        return getContract(GOVERNANCE_TOKEN_NAME);
    }

    function getRewardsDistributionContract() external view returns (address) {
        return getContract(REWARDS_DISTRIBUTION_NAME);
    }

    function getPriceManagerContract() external view returns (address) {
        return getContract(PRICE_MANAGER_NAME);
    }

    function getLiquidityPoolRegistryContract() external view returns (address) {
        return getContract(LIQUIDITY_POOL_REGISTRY_NAME);
    }

    function getUserInfoRegistryContract() external view returns (address) {
        return getContract(USER_INFO_REGISTRY_NAME);
    }

    function getContract(bytes32 _name) public view returns (address) {
        require(_contracts[_name] != address(0), "Registry: This mapping doesn't exist");

        return _contracts[_name];
    }

    function hasContract(bytes32 _name) external view returns (bool) {
        return _contracts[_name] != address(0);
    }

    function getUpgrader() external view returns (address) {
        require(address(upgrader) != address(0), "Registry: Bad upgrader.");

        return address(upgrader);
    }

    function getImplementation(bytes32 _name) external view returns (address) {
        address _contractProxy = _contracts[_name];

        require(_contractProxy != address(0), "Registry: This mapping doesn't exist.");
        require(_isProxy[_contractProxy], "Registry: Not a proxy contract.");

        return upgrader.getImplementation(_contractProxy);
    }

    function injectDependencies(bytes32 _name) external onlyAdmin {
        address contractAddress = _contracts[_name];

        require(contractAddress != address(0), "Registry: This mapping doesn't exist.");

        AbstractDependant dependant = AbstractDependant(contractAddress);

        if (dependant.injector() == address(0)) {
            dependant.setInjector(address(this));
        }

        dependant.setDependencies(this);
    }

    function upgradeContract(bytes32 _name, address _newImplementation) external onlyAdmin {
        _upgradeContract(_name, _newImplementation, "");
    }

    /// @notice can only call functions that have no parameters
    function upgradeContractAndCall(
        bytes32 _name,
        address _newImplementation,
        string calldata _functionSignature
    ) external onlyAdmin {
        _upgradeContract(_name, _newImplementation, _functionSignature);
    }

    function _upgradeContract(
        bytes32 _name,
        address _newImplementation,
        string memory _functionSignature
    ) internal {
        address _contractToUpgrade = _contracts[_name];

        require(_contractToUpgrade != address(0), "Registry: This mapping doesn't exist.");
        require(_isProxy[_contractToUpgrade], "Registry: Not a proxy contract.");

        if (bytes(_functionSignature).length > 0) {
            upgrader.upgradeAndCall(
                _contractToUpgrade,
                _newImplementation,
                abi.encodeWithSignature(_functionSignature)
            );
        } else {
            upgrader.upgrade(_contractToUpgrade, _newImplementation);
        }
    }

    function addContract(bytes32 _name, address _contractAddress) external onlyAdmin {
        require(_contractAddress != address(0), "Registry: Null address is forbidden.");
        require(_contracts[_name] == address(0), "Registry: Unable to change the contract.");

        _contracts[_name] = _contractAddress;

        emit ContractAdded(_name, _contractAddress);
    }

    function addProxyContract(bytes32 _name, address _contractAddress) external onlyAdmin {
        require(_contractAddress != address(0), "Registry: Null address is forbidden.");
        require(_contracts[_name] == address(0), "Registry: Unable to change the contract.");

        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            _contractAddress,
            address(upgrader),
            ""
        );

        _contracts[_name] = address(proxy);
        _isProxy[address(proxy)] = true;

        emit ProxyContractAdded(_name, address(proxy), _contractAddress);
    }
}
