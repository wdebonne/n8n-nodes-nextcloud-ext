module.exports = {
  root: true,
  env: {
    browser: true,
    es6: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
    sourceType: 'module',
    extraFileExtensions: ['.json'],
  },
  plugins: ['eslint-plugin-n8n-nodes-base'],
  extends: ['plugin:eslint-plugin-n8n-nodes-base/community'],
  rules: {
    'n8n-nodes-base/node-execute-block-missing-continue-on-fail': 'warn',
    'n8n-nodes-base/node-param-description-missing-from-dynamic-options': 'warn',
  },
};
