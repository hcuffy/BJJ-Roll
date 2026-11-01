import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import unicorn from "eslint-plugin-unicorn";
import noProseComments from "./eslint/noProseComments.js";

const namingConvention = [
  { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
  { selector: "variable", modifiers: ["const", "global"], types: ["boolean", "string", "number"], format: ["camelCase", "UPPER_CASE"] },
  { selector: "variable", modifiers: ["destructured"], format: null },
  { selector: "typeLike", format: ["PascalCase"] },
  { selector: ["objectLiteralProperty", "typeProperty"], format: null },
  { selector: "import", format: null },
];
const notPascalHook = { regex: "^Use[A-Z]", match: false };
const componentNamingConvention = [
  ...namingConvention,
  { selector: "function", format: ["camelCase", "PascalCase"], custom: notPascalHook },
  { selector: "variable", modifiers: ["const"], types: ["function"], format: ["camelCase", "PascalCase"], custom: notPascalHook },
];

const globalAugmentationBan = {
  selector: "TSModuleDeclaration[kind='global']",
  message: "Global augmentation goes only in the package's globals.d.ts.",
};
const rawDateMessage = "Use the package's src/dates.ts (dayjs) instead of the raw Date clock or constructor.";
const rawDateBan = [
  { selector: "NewExpression[callee.name='Date']", message: rawDateMessage },
  { selector: "MemberExpression[object.name='Date'][property.name=/^(now|parse|UTC)$/]", message: rawDateMessage },
  { selector: "MemberExpression[object.name='globalThis'][property.name='Date']", message: rawDateMessage },
];
const authCatchReturnBan = {
  selector: "CatchClause > BlockStatement[body.length=1] > ReturnStatement > Literal.argument[raw=/^(null|false)$/]",
  message: "In src/auth, a catch must not only return null or false; rethrow anything that is not an expected auth miss.",
};
const fetchSignalBan = {
  selector:
    "CallExpression:matches([callee.name='fetch'], [callee.property.name=/^fetch/i]):not(:has(ObjectExpression > Property[key.name='signal']))",
  message: "Backend fetch calls need a timeout: pass signal: AbortSignal.timeout(...).",
};
const dateBoundaryFiles = ["packages/*/src/dates.ts", "**/__tests__/**", "**/*.test.{ts,tsx}"];

const utilityLibraryMessage = "Use per-function named imports from es-toolkit instead.";
const utilityImportBans = {
  paths: [{ name: "es-toolkit", importNames: ["default"], message: "Import es-toolkit functions by name: import { groupBy } from 'es-toolkit'." }],
  patterns: [
    { group: ["lodash", "lodash/*", "lodash-es", "lodash-es/*", "lodash.*", "underscore", "underscore/*"], message: utilityLibraryMessage },
    { group: ["es-toolkit/*"], message: "Import es-toolkit functions by name from 'es-toolkit' itself." },
  ],
};
const serverOnlyImportBans = {
  paths: [{ name: "@bjj-roll/shared/encryption", message: "Server-only module (HEN-63). Do not import it in client code." }],
  patterns: [
    {
      group: ["@bjj-roll/shared/encryption/*", "**/shared/src/encryption", "**/shared/src/encryption/*"],
      message: "Server-only module (HEN-63).",
    },
  ],
};

const unlintedFiles = ["**/vitest.config.ts", "**/vite.config.ts", "**/scripts/**", "**/babel.config.js", "**/metro.config.js"];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/.expo/**"],
  },
  { ...js.configs.recommended, ignores: unlintedFiles },
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: unlintedFiles,
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { unicorn },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "no-restricted-syntax": ["error", globalAugmentationBan, ...rawDateBan],
      "no-restricted-imports": ["error", utilityImportBans],
      "@typescript-eslint/naming-convention": ["error", ...namingConvention],
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
  {
    files: ["**/globals.d.ts"],
    rules: { "no-restricted-syntax": ["error", ...rawDateBan] },
  },
  {
    files: ["packages/backend/src/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", globalAugmentationBan, ...rawDateBan, fetchSignalBan] },
  },
  {
    files: dateBoundaryFiles,
    rules: { "no-restricted-syntax": ["error", globalAugmentationBan] },
  },
  {
    files: ["packages/backend/src/auth/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", globalAugmentationBan, ...rawDateBan, authCatchReturnBan, fetchSignalBan] },
  },
  {
    files: ["**/*.tsx"],
    rules: { "@typescript-eslint/naming-convention": ["error", ...componentNamingConvention] },
  },
  {
    files: ["**/*.config.{js,ts}", "packages/mobile/app/**/_layout.tsx"],
    rules: { "@typescript-eslint/naming-convention": "off" },
  },
  {
    files: ["packages/mobile/**/*.{ts,tsx}", "packages/frontend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...serverOnlyImportBans.paths, ...utilityImportBans.paths],
          patterns: [...serverOnlyImportBans.patterns, ...utilityImportBans.patterns],
        },
      ],
    },
  },
  eslintConfigPrettier,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      curly: ["error", "all"],
      "max-len": ["error", { code: 150 }],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { local: { rules: { "no-prose-comments": noProseComments } } },
    rules: { "local/no-prose-comments": "error" },
  },
);
