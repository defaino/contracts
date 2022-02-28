module.exports = {
  extends: ["eslint:recommended", "google"],
  env: {
    mocha: true,
    node: true,
    es6: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
  },
  rules: {
    indent: [
      "error",
      2,
      {
        CallExpression: {
          arguments: 1,
        },
        FunctionDeclaration: {
          body: 1,
          parameters: 1,
        },
        FunctionExpression: {
          body: 1,
          parameters: 1,
        },
        MemberExpression: 0,
        ObjectExpression: 1,
        SwitchCase: 1,
        ignoredNodes: ["ConditionalExpression"],
      },
    ],
    "new-cap": 0,
    "require-jsdoc": 0,
    "max-len": [
      2,
      {
        code: 120,
        tabWidth: 4,
        ignoreUrls: true,
        // Mocha tests are calls to function it() with usually long test name.
        ignorePattern: "( it|describe)\\(",
      },
    ],
  },
  globals: {
    artifacts: true,
    web3: true,
    contract: true,
    assert: true,
  },
};
