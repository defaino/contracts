const PureParametersMock = artifacts.require("PureParametersMock.sol");

const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

contract("PureParametersMock", async (accounts) => {
  const reverter = new Reverter(web3);

  const ParamType = {
    NOT_EXIST: 0,
    UINT: 1,
    ADDRESS: 2,
    BYTES32: 3,
    BOOL: 4,
  };

  const NOTHING = accounts[5];

  let pureParameters;

  function toBytes(string) {
    return web3.utils.asciiToHex(string);
  }

  function fromBytes(bytes) {
    return web3.utils.hexToAscii(bytes).replace(/\0/g, "");
  }

  before("setup", async () => {
    pureParameters = await PureParametersMock.new();

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("makeUintParam()", async () => {
    it("Should make struct param with not empty uint", async () => {
      const num = 7;
      const result = await pureParameters.makeUintParam(num);

      assert.equal(result.uintParam, num);
      assert.equal(result.currentType, ParamType.UINT);
    });
  });

  describe("getUintFromParam()", async () => {
    it("Should get from struct param empty uint", async () => {
      const num = 7;
      const mock = await pureParameters.makeUintParam(num);
      const result = await pureParameters.getUintFromParam(mock);

      assert.equal(result, num);
    });
  });

  describe("makeAdrressParam()", async () => {
    it("Should make struct param with not empty address", async () => {
      const address = NOTHING;
      const result = await pureParameters.makeAdrressParam(address);

      assert.equal(result.addressParam, address);
      assert.equal(result.currentType, ParamType.ADDRESS);
    });
  });

  describe("getAdrressFromParam()", async () => {
    it("Should get from struct param empty address", async () => {
      const address = NOTHING;
      const mock = await pureParameters.makeAdrressParam(address);
      const result = await pureParameters.getAdrressFromParam(mock);

      assert.equal(result, address);
    });
  });

  describe("makeBytes32Param()", async () => {
    it("Should make struct param with not empty bytes32", async () => {
      const text = "text";
      const bytes = toBytes(text);
      const result = await pureParameters.makeBytes32Param(bytes);

      assert.equal(fromBytes(result.bytes32Param), text);
      assert.equal(result.currentType, ParamType.BYTES32);
    });
  });

  describe("getBytes32FromParam()", async () => {
    it("Should get from struct param empty bytes32", async () => {
      const text = "text";
      const bytes = toBytes(text);
      const mock = await pureParameters.makeBytes32Param(bytes);
      const result = await pureParameters.getBytes32FromParam(mock);

      assert.equal(fromBytes(result), text);
    });
  });

  describe("makeBoolParam()", async () => {
    it("Should make struct param with not false bool", async () => {
      const result = await pureParameters.makeBoolParam(true);

      assert.equal(result.boolParam, true);
      assert.equal(result.currentType, ParamType.BOOL);
    });
  });

  describe("getBoolParam()", async () => {
    it("Should get boolfrom struct param", async () => {
      const mock = await pureParameters.makeBoolParam(true);
      const result = await pureParameters.getBoolParam(mock);

      assert.equal(result, true);
    });
  });

  describe("paramExists()", async () => {
    it("Should return true if struct param exist", async () => {
      const num = 7;
      const mock = await pureParameters.makeUintParam(num);
      const result = await pureParameters.paramExists(mock);

      assert.equal(result, true);
    });
  });
});
