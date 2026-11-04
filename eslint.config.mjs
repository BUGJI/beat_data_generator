import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

/**
 * Biome covers .ts files (including formatting), but it cannot see Vue
 * templates yet. ESLint + vue-eslint-parser validates the <template> and
 * <script setup> of every SFC; this config intentionally stays on the
 * `flat/essential` preset so it catches real bugs without fighting Prettier
 * over formatting.
 */
export default [
  {
    ignores: [
      "out/**",
      "release/**",
      "dist/**",
      "coverage/**",
      "plugins/**",
      "node_modules/**",
    ],
  },
  ...pluginVue.configs["flat/essential"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".vue"],
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-unused-vars": "off",
    },
  },
];
