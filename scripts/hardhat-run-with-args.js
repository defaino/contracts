require("@nomiclabs/hardhat-web3");

const fs_extra = require("fs-extra");
const errors = require("hardhat/internal/core/errors");
const errors_list = require("hardhat/internal/core/errors-list");
const scripts_runner = require("hardhat/internal/util/scripts-runner");

task(
  "run-with-args",
  "Runs a user-defined script after compiling the project with additional node params and script arguments"
)
  .addPositionalParam("script", "A js file to be run within hardhat's environment")
  .addFlag("noCompile", "Don't compile before running this task")
  .addOptionalParam("nodeArgs", "Additional node arguments. Multiple args passe in formate 'param1 param2 ...'")
  .addOptionalVariadicPositionalParam("scriptArgs", "Additional script arguments", [])
  .setAction(async ({ script, noCompile, nodeArgs, scriptArgs }, hre) => {
    if (!(await fs_extra.pathExists(script))) {
      throw new errors.HardhatError(errors_list.ERRORS.BUILTIN_TASKS.RUN_FILE_NOT_FOUND, {
        script,
      });
    }

    if (!noCompile) {
      await hre.run("compile", { quiet: true });
    }

    let extraNodeArgs = [];

    if (nodeArgs !== undefined) {
      extraNodeArgs = nodeArgs.split(" ");
    }

    try {
      process.exitCode = await scripts_runner.runScriptWithHardhat(
        hre.hardhatArguments,
        script,
        scriptArgs,
        extraNodeArgs
      );
    } catch (error) {
      if (error instanceof Error) {
        throw new errors.HardhatError(
          errors_list.ERRORS.BUILTIN_TASKS.RUN_SCRIPT_ERROR,
          {
            script,
            error: error.message,
          },
          error
        );
      }
      throw error;
    }
  });

module.exports = {};
