import assert from "node:assert/strict";
import test from "node:test";
import { dependencyRefs, resolveDependencies } from "./resolve-core-dependencies.mjs";

function manifest(version = "v0.1.0") {
  return {
    Require: ["remote", "rdp"].map(name => ({ Path: `termous/${name}`, Version: "v0.0.0" })),
    Replace: ["remote", "rdp"].map(name => ({
      Old: { Path: `termous/${name}` },
      New: { Path: `github.com/Countra/termous-${name}`, Version: version },
    })),
  };
}

test("从 Core 替换规则解析两个固定版本，只输出完整提交", () => {
  const calls = [];
  const result = resolveDependencies(manifest(), (repository, ref) => {
    calls.push([repository, ref]);
    return `${"a".repeat(40)}\n`;
  });
  assert.deepEqual(calls, [
    ["Countra/termous-remote", "refs/tags/v0.1.0"],
    ["Countra/termous-rdp", "refs/tags/v0.1.0"],
  ]);
  assert.deepEqual(result, {
    remote_repository: "Countra/termous-remote", remote_sha: "a".repeat(40),
    rdp_repository: "Countra/termous-rdp", rdp_sha: "a".repeat(40),
  });
});

test("精确版本替换优先于通用替换，忽略其他版本的替换", () => {
  const input = manifest();
  input.Replace.push({
    Old: { Path: "termous/remote", Version: "v0.0.0" },
    New: { Path: "github.com/Example/remote", Version: "v1.2.0-rc.1" },
  }, {
    Old: { Path: "termous/rdp", Version: "v0.9.0" },
    New: { Path: "../termous-rdp" },
  });
  const refs = dependencyRefs(input);
  assert.equal(refs[0].repository, "Example/remote");
  assert.equal(refs[0].ref, "refs/tags/v1.2.0-rc.1");
  assert.equal(refs[1].ref, "refs/tags/v0.1.0");
});

test("Go 伪版本按提交短哈希解析并校验返回结果", () => {
  for (const version of [
    "v0.0.0-20261016010203-abcdef012345",
    "v0.1.1-0.20261016010203-abcdef012345",
    "v1.0.0-rc.1.0.20261016010203-abcdef012345",
  ]) {
    const input = manifest(version);
    assert.equal(dependencyRefs(input)[0].ref, "abcdef012345");
    assert.equal(resolveDependencies(input, () => `abcdef012345${"0".repeat(28)}`).remote_sha,
      `abcdef012345${"0".repeat(28)}`);
    assert.throws(() => resolveDependencies(input, () => "a".repeat(40)), /匹配的完整提交/u);
  }
});

test("兼容版本标记不属于 Git 标签名", () => {
  assert.equal(dependencyRefs(manifest("v2.0.0+incompatible"))[0].ref, "refs/tags/v2.0.0");
  const timestampTag = "v1.2.3-preview.20261016010203-abcdef012345";
  assert.equal(dependencyRefs(manifest(timestampTag))[0].ref, `refs/tags/${timestampTag}`);
});

test("拒绝缺失依赖、本地路径、浮动版本和非法输出", () => {
  const missing = manifest();
  missing.Require.pop();
  assert.throws(() => dependencyRefs(missing), /缺少直接依赖/u);
  const local = manifest();
  local.Replace[0].New = { Path: "../termous-remote" };
  assert.throws(() => dependencyRefs(local), /固定 Go 版本/u);
  for (const version of ["", "main", "latest", "v01.0.0", "v0.1.0-01", "v0.1.0\nsha=injected"]) {
    assert.throws(() => dependencyRefs(manifest(version)), /固定 Go 版本/u);
  }
  for (const sha of ["null", "a".repeat(12), `${"a".repeat(40)}\nkey=value`]) {
    assert.throws(() => resolveDependencies(manifest(), () => sha), /完整提交/u);
  }
});
