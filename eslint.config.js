import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import unicorn from "eslint-plugin-unicorn";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.expo/**",
      "**/vitest.config.ts",
      "**/scripts/**",
      "**/babel.config.js",
      "**/metro.config.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { unicorn },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
        { selector: "variable", format: ["camelCase", "UPPER_CASE", "PascalCase"] },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: ["objectLiteralProperty", "typeProperty"], format: null },
        { selector: "import", format: null },
      ],
      // Full names: no abbreviations (silly-rabbit allowList) + no 1–2 char identifiers
      "unicorn/name-replacements": [
        "error",
        { replacements: { db: false }, allowList: { env: true, deps: true, Deps: true, props: true, Props: true }, ignore: ["e2e"] },
      ],
      "unicorn/catch-error-name": ["error", { name: "error" }],
      "id-length": ["error", { min: 3, properties: "never", exceptions: ["id", "db", "to", "on", "at", "x", "y"] }],
      "max-params": ["error", 3],
      "max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
      "max-len": ["error", { code: 150 }],
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "no-nested-ternary": "error",
      "no-unneeded-ternary": "error",
      "no-duplicate-imports": "error",
      "no-var": "error",
      "prefer-const": "error",
      "prefer-template": "error",
      "require-await": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  eslintConfigPrettier,
  {
    files: ["**/*.config.{js,ts}", "packages/mobile/app/**/_layout.tsx"],
    rules: { "@typescript-eslint/naming-convention": "off" },
  },
);
