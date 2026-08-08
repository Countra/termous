import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import stylelint from "stylelint";

import stylelintConfig from "../../stylelint.config.mjs";
import {
  assertLegacyCssAllowlist,
  assertNoUnscopedGlobalAllowlist,
} from "./check.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");
const fixtureRoot = path.join(scriptDirectory, "fixtures", "legacy-css");

function withStyleFixture(
  files,
  callback,
  legacyCssFiles = [],
  noUnscopedGlobalDisabledFiles = [],
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termous-style-check-"));
  const allowlistPath = path.join(root, "allowlist.json");
  const noUnscopedGlobalAllowlistPath = path.join(
    root,
    "no-unscoped-global-allowlist.json",
  );
  try {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    for (const [relativePath, content] of Object.entries(files)) {
      const targetPath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, "utf8");
    }
    fs.writeFileSync(
      allowlistPath,
      `${JSON.stringify({ schemaVersion: 1, legacyCssFiles }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      noUnscopedGlobalAllowlistPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          disabledFiles: noUnscopedGlobalDisabledFiles,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return callback({
      allowlistPath,
      noUnscopedGlobalAllowlistPath,
      root,
    });
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

test("legacy CSS 清单与现有文件完全一致时通过", () => {
  const result = assertLegacyCssAllowlist({
    allowlistPath: path.join(fixtureRoot, "allowlist-exact.json"),
    projectRoot: fixtureRoot,
  });

  assert.deepEqual(result.actualFiles, [
    "src/base.css",
    "src/features/example.css",
  ]);
});

test("legacy CSS 清单拒绝新增但未登记的 CSS", () => {
  assert.throws(
    () =>
      assertLegacyCssAllowlist({
        allowlistPath: path.join(fixtureRoot, "allowlist-new-css.json"),
        projectRoot: fixtureRoot,
      }),
    /未登记.*src\/features\/example\.css/su,
  );
});

test("legacy CSS 清单拒绝已删除但未收口的条目", () => {
  assert.throws(
    () =>
      assertLegacyCssAllowlist({
        allowlistPath: path.join(fixtureRoot, "allowlist-stale.json"),
        projectRoot: fixtureRoot,
      }),
    /已经删除或迁移.*src\/removed\.css/su,
  );
});

test("样式清单允许业务 Module SCSS 和共享全局 SCSS", () => {
  withStyleFixture(
    {
      "src/features/example/View.module.scss": ".root { color: red; }",
      "src/shared/styles/root.scss": ":root { color: red; }",
    },
    ({ allowlistPath, root }) => {
      assert.doesNotThrow(() =>
        assertLegacyCssAllowlist({ allowlistPath, projectRoot: root }),
      );
    },
  );
});

test("样式清单拒绝业务目录中的非 Module SCSS", () => {
  withStyleFixture(
    { "src/features/example/unsafe.scss": "body { color: red; }" },
    ({ allowlistPath, root }) => {
      assert.throws(
        () => assertLegacyCssAllowlist({ allowlistPath, projectRoot: root }),
        /必须使用 \*\.module\.scss.*unsafe\.scss/su,
      );
    },
  );
});

test("样式清单拒绝 Sass 和非小写扩展名", () => {
  withStyleFixture(
    {
      "src/features/example/legacy.sass": ".root\n  color: red",
      "src/features/example/view.module.SCSS": ".root { color: red; }",
    },
    ({ allowlistPath, root }) => {
      assert.throws(
        () => assertLegacyCssAllowlist({ allowlistPath, projectRoot: root }),
        /不支持 \.sass.*扩展名必须使用小写/su,
      );
    },
  );
});

test(
  "样式清单拒绝 src 内的符号链接",
  { skip: process.platform === "win32" ? "Windows 创建符号链接需要额外权限" : false },
  () => {
    withStyleFixture({}, ({ allowlistPath, root }) => {
      const targetPath = path.join(root, "target.txt");
      fs.writeFileSync(targetPath, "target", "utf8");
      fs.symlinkSync(targetPath, path.join(root, "src", "linked.txt"));
      assert.throws(
        () => assertLegacyCssAllowlist({ allowlistPath, projectRoot: root }),
        /src 内不允许符号链接.*linked\.txt/su,
      );
    });
  },
);

test("no-unscoped-global 清单精确识别文件级禁用", () => {
  const explicitPath = "src/features/example/Explicit.module.scss";
  const allRulesPath = "src/features/example/AllRules.module.scss";
  const escapedQuotePath = "src/features/example/EscapedQuote.module.scss";
  const lineCommentPath = "src/features/example/LineComment.module.scss";
  const trailingBlockPath = "src/features/example/TrailingBlock.module.scss";
  withStyleFixture(
    {
      [explicitPath]: `/* stylelint-disable termous/no-unscoped-global, color-hex-length -- 测试显式规则禁用。 */\n:global { .legacy { color: red; } }`,
      [allRulesPath]: `/* stylelint-disable -- 测试全部规则禁用。 */\n:global { .legacy { color: red; } }`,
      [escapedQuotePath]: `.root { --fixture: foo\\'bar; }\n/* stylelint-disable termous/no-unscoped-global -- 测试引号外转义。 */\n:global { .legacy { color: red; } }`,
      [lineCommentPath]: `// stylelint-disable termous/no-unscoped-global -- 测试 SCSS 行注释文件级禁用。\n:global { .legacy { color: red; } }`,
      [trailingBlockPath]: `.root { color: red; } /* stylelint-disable termous/no-unscoped-global -- 测试尾随块注释文件级禁用。 */\n:global { .legacy { color: red; } }`,
      "src/features/example/LineOnly.module.scss": `/* stylelint-disable-next-line termous/no-unscoped-global -- 测试单行禁用。 */\n:global(.legacy) { color: red; }`,
      "src/features/example/LineCommentNextLine.module.scss": `// stylelint-disable-next-line termous/no-unscoped-global -- 测试 SCSS 行注释单行禁用。\n:global(.legacy) { color: red; }`,
      "src/features/example/StringLiteral.module.scss": `.root::before { content: "/* stylelint-disable termous/no-unscoped-global */"; }`,
      "src/features/example/LineStringLiteral.module.scss": `.root::before { content: "// stylelint-disable termous/no-unscoped-global"; }`,
    },
    ({ noUnscopedGlobalAllowlistPath, root }) => {
      const result = assertNoUnscopedGlobalAllowlist({
        allowlistPath: noUnscopedGlobalAllowlistPath,
        projectRoot: root,
      });
      assert.deepEqual(result.actualFiles, [
        allRulesPath,
        escapedQuotePath,
        explicitPath,
        lineCommentPath,
        trailingBlockPath,
      ]);
    },
    [],
    [
      allRulesPath,
      escapedQuotePath,
      explicitPath,
      lineCommentPath,
      trailingBlockPath,
    ],
  );
});

test("no-unscoped-global 清单拒绝新增但未登记的文件级禁用", () => {
  const disabledPath = "src/features/example/Unsafe.module.scss";
  withStyleFixture(
    {
      [disabledPath]: `/* stylelint-disable termous/no-unscoped-global -- 测试新增豁免。 */\n:global { .legacy { color: red; } }`,
    },
    ({ noUnscopedGlobalAllowlistPath, root }) => {
      assert.throws(
        () =>
          assertNoUnscopedGlobalAllowlist({
            allowlistPath: noUnscopedGlobalAllowlistPath,
            projectRoot: root,
          }),
        /新增但未登记.*Unsafe\.module\.scss/su,
      );
    },
  );
});

test("no-unscoped-global 清单拒绝已经消除的过期条目", () => {
  const safePath = "src/features/example/Safe.module.scss";
  withStyleFixture(
    { [safePath]: ".root { color: red; }" },
    ({ noUnscopedGlobalAllowlistPath, root }) => {
      assert.throws(
        () =>
          assertNoUnscopedGlobalAllowlist({
            allowlistPath: noUnscopedGlobalAllowlistPath,
            projectRoot: root,
          }),
        /已经消除.*Safe\.module\.scss/su,
      );
    },
    [],
    [safePath],
  );
});

test("no-unscoped-global 清单拒绝格式错误", () => {
  const invalidCases = [
    {
      name: "额外字段",
      value: { schemaVersion: 1, disabledFiles: [], extra: true },
      expected: /格式无效/u,
    },
    {
      name: "非法路径",
      value: {
        schemaVersion: 1,
        disabledFiles: ["src\\features\\example\\Unsafe.module.scss"],
      },
      expected: /无效路径/u,
    },
    {
      name: "重复路径",
      value: {
        schemaVersion: 1,
        disabledFiles: [
          "src/features/example/Unsafe.module.scss",
          "src/features/example/Unsafe.module.scss",
        ],
      },
      expected: /重复路径/u,
    },
    {
      name: "路径未排序",
      value: {
        schemaVersion: 1,
        disabledFiles: [
          "src/features/example/Z.module.scss",
          "src/features/example/A.module.scss",
        ],
      },
      expected: /字典序/u,
    },
  ];

  withStyleFixture({}, ({ noUnscopedGlobalAllowlistPath, root }) => {
    for (const invalidCase of invalidCases) {
      fs.writeFileSync(
        noUnscopedGlobalAllowlistPath,
        `${JSON.stringify(invalidCase.value, null, 2)}\n`,
        "utf8",
      );
      assert.throws(
        () =>
          assertNoUnscopedGlobalAllowlist({
            allowlistPath: noUnscopedGlobalAllowlistPath,
            projectRoot: root,
          }),
        invalidCase.expected,
        invalidCase.name,
      );
    }
  });
});

async function lintModuleSelector(selector) {
  return lintModuleCode(`${selector} { color: var(--text-color); }`);
}

async function lintModuleCode(code) {
  const result = await stylelint.lint({
    code,
    codeFilename: path.join(projectRoot, "src", "stylelint-fixture.module.scss"),
    config: stylelintConfig,
  });
  return result.results[0].warnings;
}

function hasScopeWarning(warnings) {
  return warnings.some((warning) => warning.rule === "termous/no-unscoped-global");
}

test("CSS Modules 允许由本地 class 直接限定的 global", async () => {
  for (const selector of [
    ".root :global(.x)",
    ".root > :global(.x)",
  ]) {
    const warnings = await lintModuleSelector(selector);
    assert.deepEqual(warnings, [], selector);
  }
});

test("CSS Modules 允许可证明由本地 class 祖先限定的嵌套 global", async () => {
  for (const code of [
    ".root { :global(.ant-x) { color: var(--text-color); } }",
    ".root, .panel { :global(.ant-x) { color: var(--text-color); } }",
    ".outer { section, article { :global(.ant-x) { color: var(--text-color); } } }",
  ]) {
    const warnings = await lintModuleCode(code);
    assert.deepEqual(warnings, [], code);
  }
});

test("CSS Modules 支持可证明所有分支安全的 local、is 和 where", async () => {
  for (const selector of [
    ":local(.root) :global(.x)",
    ":is(.root, .panel) :global(.x)",
    ":where(:local(.root), .panel) > :global(.x)",
  ]) {
    const warnings = await lintModuleSelector(selector);
    assert.equal(hasScopeWarning(warnings), false, selector);
  }
});

test("CSS Modules 允许由本地祖先限定的元素和属性选择器", async () => {
  for (const code of [
    ".root { button { color: var(--text-color); } }",
    ".root [data-state='active'] { color: var(--text-color); }",
  ]) {
    const warnings = await lintModuleCode(code);
    assert.equal(hasScopeWarning(warnings), false, code);
  }
});

test("CSS Modules 拒绝可绕过本地 class 限定的 global", async () => {
  for (const selector of [
    ":global(.x)",
    ".root, :global(.x)",
    ":is(:global(.x))",
    "section :global(.x)",
  ]) {
    const warnings = await lintModuleSelector(selector);
    assert.equal(hasScopeWarning(warnings), true, selector);
  }
});

test("CSS Modules 拒绝没有本地 class 作用域的普通选择器", async () => {
  for (const selector of [
    "body",
    ":root",
    "[data-theme='dark']",
    "*",
    ".root, body",
  ]) {
    const warnings = await lintModuleSelector(selector);
    assert.equal(hasScopeWarning(warnings), true, selector);
  }
});

test("CSS Modules 不将 not、has 或不完整的 is 分支视为安全作用域", async () => {
  for (const selector of [
    ":not(.root)",
    ":has(.root)",
    ":not(.root) :global(.x)",
    ":is(.root, section) :global(.x)",
  ]) {
    const warnings = await lintModuleSelector(selector);
    assert.equal(hasScopeWarning(warnings), true, selector);
  }
});

test("CSS Modules 拒绝无法证明每个祖先分支都安全的嵌套 global", async () => {
  for (const code of [
    ".root, section { :global(.x) { color: var(--text-color); } }",
    ".root { :is(:global(.x)) { color: var(--text-color); } }",
    ".root { @at-root { :global(.x) { color: var(--text-color); } } }",
  ]) {
    const warnings = await lintModuleCode(code);
    assert.equal(hasScopeWarning(warnings), true, code);
  }
});

test("CSS Modules 跳过 keyframes 内部步骤选择器", async () => {
  const warnings = await lintModuleCode(`
    @keyframes pulse {
      from { opacity: 0; }
      50% { opacity: 0.5; }
      to { opacity: 1; }
    }
  `);
  assert.equal(hasScopeWarning(warnings), false);
});
