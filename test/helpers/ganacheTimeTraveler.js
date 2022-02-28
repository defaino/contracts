const advanceBlockAtTime = (time) => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [time],
        id: new Date().getTime(),
      },
      (err, _) => {
        if (err) {
          return reject(err);
        }
        const newBlockHash = web3.eth.getBlock("latest").hash;

        return resolve(newBlockHash);
      }
    );
  });
};

async function getCurrentBlock() {
  return (await web3.eth.getBlock("latest")).number;
}

async function advanceBlocks(amount) {
  for (let i = 0; i < amount; i++) {
    await advanceBlockAtTime(1);
  }
}

module.exports = {
  advanceBlockAtTime,
  getCurrentBlock,
  advanceBlocks,
};
