function toBytes(string) {
  return web3.utils.asciiToHex(string);
}

function fromBytes(bytes) {
  return web3.utils.hexToAscii(bytes).replace(/\0/g, "");
}

function compareKeys(key1, key2) {
  return fromBytes(key1) == fromBytes(key2);
}

function deepCompareKeys(keys1, keys2) {
  if (keys1.length != keys2.length) {
    return false;
  }

  for (let i = 0; i < keys1.length; i++) {
    if (!compareKeys(keys1[i], keys2[i])) {
      return false;
    }
  }

  return true;
}

module.exports = {
  toBytes,
  fromBytes,
  compareKeys,
  deepCompareKeys,
};
