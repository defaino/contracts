const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");

const { artifacts } = require("hardhat");
const { utils } = require("ethers");
const { accounts } = require("../scripts/utils/utils");
const { assert } = require("chai");

const RoleManager = artifacts.require("RoleManager");

if (!String.prototype.format) {
  String.prototype.format = function (...args) {
    return this.replace(/(\{\d+\})/g, function (a) {
      return args[+a.substr(1, a.length - 2) || 0];
    });
  };
}

describe("RoleManager", () => {
  const reverter = new Reverter();

  let ROLE_MANAGER_ADMIN;
  let ANOTHER_ACCOUNT;
  let ANOTHER_ACCOUNT1;
  let ANOTHER_ACCOUNT2;

  let roleManager;

  before("setup", async () => {
    ROLE_MANAGER_ADMIN = await accounts(0);
    ANOTHER_ACCOUNT = await accounts(1);
    ANOTHER_ACCOUNT1 = await accounts(2);
    ANOTHER_ACCOUNT2 = await accounts(3);

    const _roleManager = await RoleManager.new();

    roleManager = await RoleManager.at(_roleManager.address);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("roleManagerInitialize()", () => {
    it("should correctly grant the ROLE_MANAGER_ADMIN role to msg.sender", async () => {
      await roleManager.roleManagerInitialize([], []);
      const ROLE_MANAGER_ADMIN_ROLE = utils.keccak256(utils.toUtf8Bytes("ROLE_MANAGER_ADMIN"));
      assert.equal(await roleManager.hasRole(ROLE_MANAGER_ADMIN_ROLE, ROLE_MANAGER_ADMIN), true);
    });

    it("should grant the roles passed to the corresponding accounts", async () => {
      const ROLE_MANAGER_ADMIN_ROLE = utils.keccak256(utils.toUtf8Bytes("ROLE_MANAGER_ADMIN"));
      const PRT_PARAM_UPDATER_ROLE = utils.keccak256(utils.toUtf8Bytes("PRT_PARAM_UPDATER"));
      const DEFI_CORE_PAUSER_ROLE = utils.keccak256(utils.toUtf8Bytes("DEFI_CORE_PAUSER"));
      const SYSTEM_POOLS_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("SYSTEM_POOLS_MANAGER"));

      await roleManager.roleManagerInitialize(
        [PRT_PARAM_UPDATER_ROLE, DEFI_CORE_PAUSER_ROLE, SYSTEM_POOLS_MANAGER_ROLE],
        [ANOTHER_ACCOUNT, ANOTHER_ACCOUNT1, ANOTHER_ACCOUNT2]
      );

      assert.equal(await roleManager.hasRole(ROLE_MANAGER_ADMIN_ROLE, ROLE_MANAGER_ADMIN), true);
      assert.equal(await roleManager.hasRole(PRT_PARAM_UPDATER_ROLE, ANOTHER_ACCOUNT), true);
      assert.equal(await roleManager.hasRole(DEFI_CORE_PAUSER_ROLE, ANOTHER_ACCOUNT1), true);
      assert.equal(await roleManager.hasRole(SYSTEM_POOLS_MANAGER_ROLE, ANOTHER_ACCOUNT2), true);

      assert.equal(await roleManager.hasRole(ROLE_MANAGER_ADMIN_ROLE, ANOTHER_ACCOUNT), false);
      assert.equal(await roleManager.hasRole(PRT_PARAM_UPDATER_ROLE, ANOTHER_ACCOUNT2), false);
      assert.equal(await roleManager.hasRole(DEFI_CORE_PAUSER_ROLE, ROLE_MANAGER_ADMIN), false);
      assert.equal(await roleManager.hasRole(SYSTEM_POOLS_MANAGER_ROLE, ANOTHER_ACCOUNT1), false);
    });

    it("should grant the same roles to multiple accounts if needed", async () => {
      const PRT_PARAM_UPDATER_ROLE = utils.keccak256(utils.toUtf8Bytes("PRT_PARAM_UPDATER"));

      await roleManager.roleManagerInitialize(
        [PRT_PARAM_UPDATER_ROLE, PRT_PARAM_UPDATER_ROLE, PRT_PARAM_UPDATER_ROLE],
        [ANOTHER_ACCOUNT, ANOTHER_ACCOUNT1, ANOTHER_ACCOUNT2]
      );

      assert.equal(await roleManager.hasRole(PRT_PARAM_UPDATER_ROLE, ANOTHER_ACCOUNT), true);
      assert.equal(await roleManager.hasRole(PRT_PARAM_UPDATER_ROLE, ANOTHER_ACCOUNT1), true);
      assert.equal(await roleManager.hasRole(PRT_PARAM_UPDATER_ROLE, ANOTHER_ACCOUNT2), true);
    });

    it("should revert if called after the initilizing", async () => {
      const reason = "Initializable: contract is already initialized";
      await roleManager.roleManagerInitialize([], []);
      await truffleAssert.reverts(roleManager.roleManagerInitialize([], []), reason);
    });

    it("should revert if roles and accounts arrays are of different size", async () => {
      const reason = "RoleManager: passed arrays are of different sizes";

      const PRT_PARAM_UPDATER_ROLE = utils.keccak256(utils.toUtf8Bytes("PRT_PARAM_UPDATER"));
      const DEFI_CORE_PAUSER_ROLE = utils.keccak256(utils.toUtf8Bytes("DEFI_CORE_PAUSER"));
      const SYSTEM_POOLS_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("SYSTEM_POOLS_MANAGER"));

      await truffleAssert.reverts(
        roleManager.roleManagerInitialize(
          [PRT_PARAM_UPDATER_ROLE, DEFI_CORE_PAUSER_ROLE, SYSTEM_POOLS_MANAGER_ROLE],
          [ANOTHER_ACCOUNT, ANOTHER_ACCOUNT1]
        ),
        reason
      );

      await truffleAssert.reverts(
        roleManager.roleManagerInitialize(
          [PRT_PARAM_UPDATER_ROLE, DEFI_CORE_PAUSER_ROLE],
          [ANOTHER_ACCOUNT, ANOTHER_ACCOUNT1, ANOTHER_ACCOUNT2]
        ),
        reason
      );
    });
  });

  describe("isAssetParametersManager()", () => {
    it("should successfuly pass if the account has the ROLE_MANAGER_ADMIN or ASSET_PARAMETERS_MANAGER role", async () => {
      const ASSET_PARAMETERS_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("ASSET_PARAMETERS_MANAGER"));

      await roleManager.roleManagerInitialize([ASSET_PARAMETERS_MANAGER_ROLE], [ANOTHER_ACCOUNT]);

      await truffleAssert.passes(roleManager.isAssetParametersManager(ANOTHER_ACCOUNT));
      await truffleAssert.passes(roleManager.isAssetParametersManager(ROLE_MANAGER_ADMIN));
    });

    it("should revert if the account has neither ROLE_MANAGER_ADMIN nor ASSET_PARAMETERS_MANAGER role", async () => {
      const ASSET_PARAMETERS_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("ASSET_PARAMETERS_MANAGER"));
      let reason = "RoleManager: account is missing role {0}".format(ASSET_PARAMETERS_MANAGER_ROLE);
      await truffleAssert.reverts(roleManager.isAssetParametersManager(ANOTHER_ACCOUNT), reason);
    });
  });

  describe("isDefiCorePauser()", () => {
    it("should successfuly pass if the account has the ROLE_MANAGER_ADMIN or DEFI_CORE_PAUSER role", async () => {
      const DEFI_CORE_PAUSER_ROLE = utils.keccak256(utils.toUtf8Bytes("DEFI_CORE_PAUSER"));

      await roleManager.roleManagerInitialize([DEFI_CORE_PAUSER_ROLE], [ANOTHER_ACCOUNT]);

      await truffleAssert.passes(roleManager.isDefiCorePauser(ANOTHER_ACCOUNT));
      await truffleAssert.passes(roleManager.isDefiCorePauser(ROLE_MANAGER_ADMIN));
    });

    it("should revert if the account has neither ROLE_MANAGER_ADMIN nor DEFI_CORE_PAUSER role", async () => {
      const DEFI_CORE_PAUSER_ROLE = utils.keccak256(utils.toUtf8Bytes("DEFI_CORE_PAUSER"));
      let reason = "RoleManager: account is missing role {0}".format(DEFI_CORE_PAUSER_ROLE);
      await truffleAssert.reverts(roleManager.isDefiCorePauser(ANOTHER_ACCOUNT), reason);
    });
  });

  describe("isPRTParamUpdater()", () => {
    it("should successfuly pass if the account has the ROLE_MANAGER_ADMIN or PRT_PARAM_UPDATER role", async () => {
      const PRT_PARAM_UPDATER_ROLE = utils.keccak256(utils.toUtf8Bytes("PRT_PARAM_UPDATER"));

      await roleManager.roleManagerInitialize([PRT_PARAM_UPDATER_ROLE], [ANOTHER_ACCOUNT]);

      await truffleAssert.passes(roleManager.isPRTParamUpdater(ANOTHER_ACCOUNT));
      await truffleAssert.passes(roleManager.isPRTParamUpdater(ROLE_MANAGER_ADMIN));
    });

    it("should revert if the account has neither ROLE_MANAGER_ADMIN nor PRT_PARAM_UPDATER role", async () => {
      const PRT_PARAM_UPDATER_ROLE = utils.keccak256(utils.toUtf8Bytes("PRT_PARAM_UPDATER"));
      let reason = "RoleManager: account is missing role {0}".format(PRT_PARAM_UPDATER_ROLE);
      await truffleAssert.reverts(roleManager.isPRTParamUpdater(ANOTHER_ACCOUNT), reason);
    });
  });

  describe("isRewardsDistributionManager()", () => {
    it("should successfuly pass if the account has the ROLE_MANAGER_ADMIN or REWARDS_DISTRIBUTION_MANAGER role", async () => {
      const REWARDS_DISTRIBUTION_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("REWARDS_DISTRIBUTION_MANAGER"));

      await roleManager.roleManagerInitialize([REWARDS_DISTRIBUTION_MANAGER_ROLE], [ANOTHER_ACCOUNT]);

      await truffleAssert.passes(roleManager.isRewardsDistributionManager(ANOTHER_ACCOUNT));
      await truffleAssert.passes(roleManager.isRewardsDistributionManager(ROLE_MANAGER_ADMIN));
    });

    it("should revert if the account has neither ROLE_MANAGER_ADMIN nor REWARDS_DISTRIBUTION_MANAGER role", async () => {
      const REWARDS_DISTRIBUTION_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("REWARDS_DISTRIBUTION_MANAGER"));
      let reason = "RoleManager: account is missing role {0}".format(REWARDS_DISTRIBUTION_MANAGER_ROLE);
      await truffleAssert.reverts(roleManager.isRewardsDistributionManager(ANOTHER_ACCOUNT), reason);
    });
  });

  describe("isSystemParametersManager()", () => {
    it("should successfuly pass if the account has the ROLE_MANAGER_ADMIN or SYSTEM_PARAMETERS_MANAGER role", async () => {
      const SYSTEM_PARAMETERS_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("SYSTEM_PARAMETERS_MANAGER"));

      await roleManager.roleManagerInitialize([SYSTEM_PARAMETERS_MANAGER_ROLE], [ANOTHER_ACCOUNT]);

      await truffleAssert.passes(roleManager.isSystemParametersManager(ANOTHER_ACCOUNT));
      await truffleAssert.passes(roleManager.isSystemParametersManager(ROLE_MANAGER_ADMIN));
    });

    it("should revert if the account has neither ROLE_MANAGER_ADMIN nor SYSTEM_PARAMETERS_MANAGER role", async () => {
      const SYSTEM_PARAMETERS_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("SYSTEM_PARAMETERS_MANAGER"));
      let reason = "RoleManager: account is missing role {0}".format(SYSTEM_PARAMETERS_MANAGER_ROLE);
      await truffleAssert.reverts(roleManager.isSystemParametersManager(ANOTHER_ACCOUNT), reason);
    });
  });

  describe("isSystemPoolsManager()", () => {
    it("should successfuly pass if the account has the ROLE_MANAGER_ADMIN or SYSTEM_POOLS_MANAGER role", async () => {
      const SYSTEM_POOLS_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("SYSTEM_POOLS_MANAGER"));

      await roleManager.roleManagerInitialize([SYSTEM_POOLS_MANAGER_ROLE], [ANOTHER_ACCOUNT]);

      await truffleAssert.passes(roleManager.isSystemPoolsManager(ANOTHER_ACCOUNT));
      await truffleAssert.passes(roleManager.isSystemPoolsManager(ROLE_MANAGER_ADMIN));
    });

    it("should revert if the account has neither ROLE_MANAGER_ADMIN nor SYSTEM_POOLS_MANAGER role", async () => {
      const SYSTEM_POOLS_MANAGER_ROLE = utils.keccak256(utils.toUtf8Bytes("SYSTEM_POOLS_MANAGER"));
      let reason = "RoleManager: account is missing role {0}".format(SYSTEM_POOLS_MANAGER_ROLE);
      await truffleAssert.reverts(roleManager.isSystemPoolsManager(ANOTHER_ACCOUNT), reason);
    });
  });

  describe("isSystemPoolsReserveFundsManager()", () => {
    it("should successfuly pass if the account has the ROLE_MANAGER_ADMIN or SYSTEM_POOLS_RESERVE_FUNDS_MANAGER role", async () => {
      const SYSTEM_POOLS_RESERVE_FUNDS_MANAGER_ROLE = utils.keccak256(
        utils.toUtf8Bytes("SYSTEM_POOLS_RESERVE_FUNDS_MANAGER")
      );

      await roleManager.roleManagerInitialize([SYSTEM_POOLS_RESERVE_FUNDS_MANAGER_ROLE], [ANOTHER_ACCOUNT]);

      await truffleAssert.passes(roleManager.isSystemPoolsReserveFundsManager(ANOTHER_ACCOUNT));
      await truffleAssert.passes(roleManager.isSystemPoolsReserveFundsManager(ROLE_MANAGER_ADMIN));
    });

    it("should revert if the account has neither ROLE_MANAGER_ADMIN nor SYSTEM_POOLS_RESERVE_FUNDS_MANAGER role", async () => {
      const SYSTEM_POOLS_RESERVE_FUNDS_MANAGER_ROLE = utils.keccak256(
        utils.toUtf8Bytes("SYSTEM_POOLS_RESERVE_FUNDS_MANAGER")
      );
      let reason = "RoleManager: account is missing role {0}".format(SYSTEM_POOLS_RESERVE_FUNDS_MANAGER_ROLE);
      await truffleAssert.reverts(roleManager.isSystemPoolsReserveFundsManager(ANOTHER_ACCOUNT), reason);
    });
  });

  describe("grantRole()", () => {
    it("should successfuly pass if the calling account has the ROLE_MANAGER_ADMIN or ROLE_MANAGER_ROLE_GOVERNOR role", async () => {
      const ROLE_MANAGER_ROLE_GOVERNOR_ROLE = utils.keccak256(utils.toUtf8Bytes("ROLE_MANAGER_ROLE_GOVERNOR"));

      const ROLE_TO_GRANT = utils.keccak256(utils.toUtf8Bytes("ASSET_PARAMETERS_MANAGER"));

      await roleManager.roleManagerInitialize([ROLE_MANAGER_ROLE_GOVERNOR_ROLE], [ANOTHER_ACCOUNT]);

      await truffleAssert.passes(roleManager.grantRole(ROLE_TO_GRANT, ANOTHER_ACCOUNT1, { from: ANOTHER_ACCOUNT }));
      await truffleAssert.passes(roleManager.grantRole(ROLE_TO_GRANT, ANOTHER_ACCOUNT1, { from: ROLE_MANAGER_ADMIN }));
    });

    it("should revert if the account has neither ROLE_MANAGER_ADMIN nor ROLE_MANAGER_ROLE_GOVERNOR role", async () => {
      const ROLE_MANAGER_ROLE_GOVERNOR_ROLE = utils.keccak256(utils.toUtf8Bytes("ROLE_MANAGER_ROLE_GOVERNOR"));
      let reason = "RoleManager: account is missing role {0}".format(ROLE_MANAGER_ROLE_GOVERNOR_ROLE);

      const ROLE_TO_GRANT = utils.keccak256(utils.toUtf8Bytes("ASSET_PARAMETERS_MANAGER"));

      await truffleAssert.reverts(
        roleManager.grantRole(ROLE_TO_GRANT, ANOTHER_ACCOUNT1, { from: ANOTHER_ACCOUNT }),
        reason
      );
    });
  });

  describe("revokeRole()", () => {
    it("should successfuly pass if the calling account has the ROLE_MANAGER_ADMIN or ROLE_MANAGER_ROLE_GOVERNOR role", async () => {
      const ROLE_MANAGER_ROLE_GOVERNOR_ROLE = utils.keccak256(utils.toUtf8Bytes("ROLE_MANAGER_ROLE_GOVERNOR"));
      const ROLE_TO_GRANT = utils.keccak256(utils.toUtf8Bytes("ASSET_PARAMETERS_MANAGER"));
      const ROLE_TO_REVOKE = ROLE_TO_GRANT;

      await roleManager.roleManagerInitialize([ROLE_MANAGER_ROLE_GOVERNOR_ROLE], [ANOTHER_ACCOUNT]);

      await roleManager.grantRole(ROLE_TO_GRANT, ANOTHER_ACCOUNT1);
      await roleManager.revokeRole(ROLE_TO_REVOKE, ANOTHER_ACCOUNT1, { from: ANOTHER_ACCOUNT });

      await roleManager.grantRole(ROLE_TO_GRANT, ANOTHER_ACCOUNT1);
      await roleManager.revokeRole(ROLE_TO_REVOKE, ANOTHER_ACCOUNT1);
    });

    it("should successfuly pass if try to revoke the role the account doesn't have", async () => {
      const ROLE_MANAGER_ROLE_GOVERNOR_ROLE = utils.keccak256(utils.toUtf8Bytes("ROLE_MANAGER_ROLE_GOVERNOR"));
      const ROLE_TO_GRANT = utils.keccak256(utils.toUtf8Bytes("ASSET_PARAMETERS_MANAGER"));
      const ROLE_TO_REVOKE = ROLE_TO_GRANT;
      const ANOTHER_ROLE_TO_REVOKE = utils.keccak256(utils.toUtf8Bytes("ANOTHER ROLE"));

      await roleManager.roleManagerInitialize([ROLE_MANAGER_ROLE_GOVERNOR_ROLE], [ANOTHER_ACCOUNT]);

      await roleManager.grantRole(ROLE_TO_GRANT, ANOTHER_ACCOUNT1);
      await roleManager.revokeRole(ROLE_TO_REVOKE, ANOTHER_ACCOUNT1, { from: ANOTHER_ACCOUNT });
      await roleManager.revokeRole(ROLE_TO_REVOKE, ANOTHER_ACCOUNT1, { from: ANOTHER_ACCOUNT });

      await roleManager.revokeRole(ANOTHER_ROLE_TO_REVOKE, ANOTHER_ACCOUNT1, { from: ANOTHER_ACCOUNT });

      await roleManager.grantRole(ROLE_TO_GRANT, ANOTHER_ACCOUNT1);
      await roleManager.revokeRole(ROLE_TO_REVOKE, ANOTHER_ACCOUNT1);
      await roleManager.revokeRole(ROLE_TO_REVOKE, ANOTHER_ACCOUNT1);

      await roleManager.revokeRole(ANOTHER_ROLE_TO_REVOKE, ANOTHER_ACCOUNT1);
    });

    it("should revert if the account has neither ROLE_MANAGER_ADMIN nor ROLE_MANAGER_ROLE_GOVERNOR role", async () => {
      const ROLE_MANAGER_ROLE_GOVERNOR_ROLE = utils.keccak256(utils.toUtf8Bytes("ROLE_MANAGER_ROLE_GOVERNOR"));
      let reason = "RoleManager: account is missing role {0}".format(ROLE_MANAGER_ROLE_GOVERNOR_ROLE);

      await roleManager.roleManagerInitialize([], []);

      const ROLE_TO_GRANT = utils.keccak256(utils.toUtf8Bytes("ASSET_PARAMETERS_MANAGER"));

      await roleManager.grantRole(ROLE_TO_GRANT, ANOTHER_ACCOUNT1);

      const ROLE_TO_REVOKE = ROLE_TO_GRANT;

      await truffleAssert.reverts(
        roleManager.revokeRole(ROLE_TO_REVOKE, ANOTHER_ACCOUNT1, { from: ANOTHER_ACCOUNT2 }),
        reason
      );
    });
  });
});
