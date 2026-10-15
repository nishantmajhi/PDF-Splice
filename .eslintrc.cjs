// `npm run lint`. ESLint 8 and eslint-plugin-vue were already in
// devDependencies, but with no configuration the script failed on the
// first file it opened.
module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  extends: ["eslint:recommended", "plugin:vue/vue3-essential"],
  ignorePatterns: ["dist/", ".against-original/"],
  rules: {
    // Pages are named for the tool they are (Splice, Split, Merge) and the
    // logo is Logo; none is used as a custom element in HTML, which is what
    // the rule guards against.
    "vue/multi-word-component-names": "off",
  },
};
