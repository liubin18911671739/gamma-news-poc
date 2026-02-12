module.exports = [
  {
    ignores: [".next/**", "node_modules/**"],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        window: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearInterval: "readonly",
        setInterval: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
