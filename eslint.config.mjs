import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      ".next/**",
      ".tmp/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "tsconfig.tsbuildinfo"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: {
        self: "readonly"
      }
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      "@next/next": nextPlugin,
      "jsx-a11y": jsxA11yPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "react-hooks/set-state-in-effect": "off",
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-undef": "off",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off"
    },
    settings: {
      next: {
        rootDir: ["./"]
      },
      react: {
        version: "detect"
      }
    }
  }
];
