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
    // `.astro/` is Astro's generated type shim for services/docs — build
    // output that happens to land outside dist/, and not ours to lint.
    //
    // `old/` is parked code: it is not imported, not compiled and not on any
    // tsconfig include path, so it references modules that have moved and
    // globals no rule set here knows about. Linting it would report dozens of
    // errors about code that deliberately is not part of the app. See
    // old/themes/README.md.
    ignores: ["**/dist/**", "**/node_modules/**", "**/.astro/**", "old/**"],
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

  // shadcn's generated components (v0.9.49). NOT ours to lint.
  //
  // `npx shadcn@latest add <name>` overwrites these files wholesale, so a
  // lint fix applied here survives exactly until the next time somebody
  // regenerates one, and then comes back as a warning nobody caused. The
  // rule that fires is react-refresh's: shadcn exports `buttonVariants`
  // beside `Button` from one file, which is its documented API and is how
  // every call site imports the variants.
  //
  // Scoped to the generated directory alone, so a component MOVED out from
  // under `ui/` (which is the documented way to take ownership of one) gets
  // linted like anything else. See src/components/README.md.
  {
    files: ["apps/app/src/components/ui/**/*.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
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

  // Playwright verify/measure scripts run in node but serialize callbacks
  // into the page (addInitScript/evaluate), so those bodies use browser
  // globals too. `measure-*` are the perf harnesses (plan 011): same shape,
  // they report a number instead of a pass/fail.
  {
    files: ["scripts/verify-*.mjs", "scripts/measure-*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // The channel dump is not run, it is PASTED into the app's DevTools
  // console, so it executes in the page and node globals are the wrong set
  // entirely. `copy` is DevTools' own clipboard helper and exists nowhere
  // else, which is exactly why the script has two fallbacks behind it.
  {
    files: ["scripts/dump-channel-names.js"],
    languageOptions: { globals: { ...globals.browser, copy: "readonly" } },
  },
);
