const { toBytes, fromBytes } = require("./helpers/bytesCompareLibrary");
const { accounts } = require("../scripts/utils");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");

const PureParametersMock = artifacts.require("PureParametersMock.sol");

describe("PureParametersMock", () => {
  const reverter = new Reverter();

  const ParamType = {
    NOT_EXIST: 0,
    UINT: 1,
    ADDRESS: 2,
    BYTES32: 3,
    BOOL: 4,
  };

  let NOTHING;

  let pureParameters;

  before("setup", async () => {
    NOTHING = await accounts(5);

    pureParameters = await PureParametersMock.new();

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("makeUintParam()", async () => {
    it("Should make struct param with not empty uint", async () => {
      const num = 7;
      const result = await pureParameters.makeUintParam(num);

      assert.equal(result.param, num);
      assert.equal(result.currentType, ParamType.UINT);
    });
  });

  describe("getUintFromParam()", () => {
    it("Should get from struct param empty uint", async () => {
      const num = 7;
      const mock = await pureParameters.makeUintParam(num);
      const result = await pureParameters.getUintFromParam(mock);

      assert.equal(result, num);
    });

    it("should get exception if param not contain uint param", async () => {
      const reason = "PureParameters: Parameter not contain uint.";
      const param = await pureParameters.makeAddressParam(NOTHING);

      await truffleAssert.reverts(pureParameters.getUintFromParam(param), reason);
    });
  });

  describe("makeAddressParam()", () => {
    it("Should make struct param with not empty address", async () => {
      const address = NOTHING;
      const result = await pureParameters.makeAddressParam(address);

      assert.equal(await pureParameters.getAddressFromParam(result), address);
      assert.equal(result.currentType, ParamType.ADDRESS);
    });
  });

  describe("getAddressFromParam()", () => {
    it("Should get from struct param empty address", async () => {
      const address = NOTHING;
      const mock = await pureParameters.makeAddressParam(address);
      const result = await pureParameters.getAddressFromParam(mock);

      assert.equal(result, address);
    });

    it("should get exception if param not contain address param", async () => {
      const reason = "PureParameters: Parameter not contain address.";
      const param = await pureParameters.makeUintParam(10);

      await truffleAssert.reverts(pureParameters.getAddressFromParam(param), reason);
    });
  });

  describe("makeBytes32Param()", () => {
    it("Should make struct param with not empty bytes32", async () => {
      const text = "text";
      const bytes = toBytes(text);
      const result = await pureParameters.makeBytes32Param(bytes);

      assert.equal(fromBytes(result.param), text);
      assert.equal(result.currentType, ParamType.BYTES32);
    });
  });

  describe("getBytes32FromParam()", () => {
    it("Should get from struct param empty bytes32", async () => {
      const text = "text";
      const bytes = toBytes(text);
      const mock = await pureParameters.makeBytes32Param(bytes);
      const result = await pureParameters.getBytes32FromParam(mock);

      assert.equal(fromBytes(result), text);
    });

    it("should get exception if param not contain bytes32 param", async () => {
      const reason = "PureParameters: Parameter not contain bytes32.";
      const param = await pureParameters.makeUintParam(10);

      await truffleAssert.reverts(pureParameters.getBytes32FromParam(param), reason);
    });
  });

  describe("makeBoolParam()", () => {
    it("Should make struct param with not false bool", async () => {
      let result = await pureParameters.makeBoolParam(true);

      assert.equal(result.param, true);
      assert.equal(result.currentType, ParamType.BOOL);

      result = await pureParameters.makeBoolParam(false);

      assert.equal(result.param, false);
      assert.equal(result.currentType, ParamType.BOOL);
    });
  });

  describe("getBoolParam()", () => {
    it("Should get bool from struct param", async () => {
      let struct = await pureParameters.makeBoolParam(true);
      let result = await pureParameters.getBoolParam(struct);

      assert.equal(result, true);

      struct = await pureParameters.makeBoolParam(false);
      result = await pureParameters.getBoolParam(struct);

      assert.equal(result, false);
    });

    it("should get exception if param not contain bool param", async () => {
      const reason = "PureParameters: Parameter not contain bool.";
      const param = await pureParameters.makeUintParam(10);

      await truffleAssert.reverts(pureParameters.getBoolParam(param), reason);
    });
  });

  describe("paramExists()", () => {
    it("Should return true if struct param exist", async () => {
      const num = 7;
      const mock = await pureParameters.makeUintParam(num);
      const result = await pureParameters.paramExists(mock);

      assert.equal(result, true);
    });
  });
});
