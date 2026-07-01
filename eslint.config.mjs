import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

const unusedVars = [
  "error",
  {
    argsIgnorePattern: "^_",
    varsIgnorePattern: "^_",
    caughtErrorsIgnorePattern: "^_",
  },
];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },

  // Base JS rules everywhere.
  js.configs.recommended,

  // TypeScript rules, scoped to TS files so they don't touch the CommonJS shell.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": unusedVars,
    },
  },

  // App: React + browser.
  {
    files: ["apps/app/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // Node ESM scripts (build helpers, this config).
  {
    files: ["*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
);
