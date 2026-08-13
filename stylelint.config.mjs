import noUnscopedGlobal from "./scripts/styles/stylelint/no-unscoped-global.mjs";

export default {
  extends: ["stylelint-config-standard-scss"],
  ignoreFiles: [
    "src/**/*.css",
    "node_modules/**",
    "dist/**",
    "dist-electron/**",
    "release/**",
    "build/**",
  ],
  reportDescriptionlessDisables: true,
  reportInvalidScopeDisables: true,
  reportNeedlessDisables: true,
  plugins: [noUnscopedGlobal],
  overrides: [
    {
      files: ["src/**/*.module.scss"],
      rules: {
        "selector-pseudo-class-no-unknown": [
          true,
          {
            ignorePseudoClasses: ["global", "local"],
          },
        ],
        "termous/no-unscoped-global": true,
      },
    },
  ],
};
