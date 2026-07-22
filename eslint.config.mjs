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

  // Node ESM scripts (build helpers, this config, the fake test panels,
  // the website builder) and the keybox service (node server + its scripts
  // and tests — all ESM via "type": "module").
  {
    files: ["*.mjs", "scripts/**/*.mjs", "website/**/*.mjs", "services/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Same _-prefix escape hatch the TS side gets: express error middleware
      // must keep 4 params, and some catch bindings are intentionally unread.
      "no-unused-vars": unusedVars,
    },
  },

  // Playwright verify scripts run in node but serialize callbacks into the
  // page (addInitScript/evaluate), so those bodies use browser globals too.
  {
    files: ["scripts/verify-*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
