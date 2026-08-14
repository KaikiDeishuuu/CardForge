import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "separate-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      // The two classic hook rules are enforced. eslint-plugin-react-hooks v7 also
      // ships the React Compiler rules (set-state-in-effect, static-components,
      // refs, purity, immutability). Every game schedules its AI turn by setting
      // state from an effect, and GameHost builds its lazy game component during
      // render on purpose, so adopting those rules is a redesign rather than a
      // lint pass. Left off deliberately; revisit if the turn schedulers change.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Node-side tooling config runs outside the browser.
    files: ["vite.config.ts", "playwright.config.ts", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["e2e/**/*.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
