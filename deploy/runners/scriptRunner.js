const Deployer = require("./deployer");

async function main() {
  const deployer = new Deployer();

  await deployer.init();

  for (let i = 2; i < process.argv.length; i++) {
    const scriptPath = "../../scripts/" + process.argv[i];

    console.log(`\nExecute script - ${scriptPath}\n`);

    const func = require(scriptPath);

    await func(deployer);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
