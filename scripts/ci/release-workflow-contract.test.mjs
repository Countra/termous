import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseDocument } from "yaml";

const workflowUrl = new URL("../../.github/workflows/release.yml", import.meta.url);
const windowsBuildScriptUrl = new URL("./build-windows.ps1", import.meta.url);
const unixBuildScriptUrl = new URL("./build-unix.sh", import.meta.url);

async function loadWorkflow() {
  const source = await readFile(workflowUrl, "utf8");
  const document = parseDocument(source, {
    maxAliasCount: 0,
    strict: true,
    uniqueKeys: true,
  });
  assert.deepEqual(
    document.errors.map(({ message }) => message),
    [],
    "Release workflow 必须是合法且无重复键的 YAML",
  );
  return { source, workflow: document.toJS({ maxAliasCount: 0 }) };
}

function stepsFor(workflow, jobName) {
  const steps = workflow.jobs?.[jobName]?.steps;
  assert.ok(Array.isArray(steps), `${jobName} 必须定义 steps`);
  return steps;
}

function assertBuiltinTokenStep(workflow, jobName, stepName) {
  const step = stepsFor(workflow, jobName).find(({ name }) => name === stepName);
  assert.ok(step, `${jobName} 缺少 ${stepName}`);
  assert.equal(step.env?.GH_TOKEN, "${{ github.token }}");
  assert.equal(typeof step.uses, "undefined");
}

test("Release workflow 不使用 Artifact Storage 或外部发布凭据", async () => {
  const { source } = await loadWorkflow();
  for (const forbidden of [
    "actions/upload-artifact",
    "actions/download-artifact",
    "actions/create-github-app-token",
    "softprops/action-gh-release",
    "RELEASE_APP_ID",
    "RELEASE_APP_PRIVATE_KEY",
    "GITHUB_ENV",
  ]) {
    assert.equal(source.includes(forbidden), false, `禁止出现 ${forbidden}`);
  }
});

test("平台构建包装器把安装目录清理交给安全打包入口", async () => {
  const [windowsSource, unixSource] = await Promise.all([
    readFile(windowsBuildScriptUrl, "utf8"),
    readFile(unixBuildScriptUrl, "utf8"),
  ]);

  assert.doesNotMatch(windowsSource, /Reset-Directory\s+-Path\s+\$installerDir/u);
  assert.doesNotMatch(unixSource, /reset_directory\s+"\$installer_dir"/u);
  assert.match(windowsSource, /node[\s\S]*scripts\/ci\/build-local-package\.mjs/u);
  assert.match(unixSource, /node\s+\\[\s\S]*scripts\/ci\/build-local-package\.mjs/u);
  assert.match(windowsSource, /Prepare-CoreOutputDirectory/u);
  assert.match(unixSource, /prepare_core_output_directory/u);
  assert.match(windowsSource, /@\("termous-core\.exe", "termous-core"\)/u);
  assert.match(unixSource, /termous-core\.exe termous-core/u);
  assert.match(windowsSource, /function Disable-CodeSigning/u);
  assert.match(unixSource, /disable_code_signing/u);
  assert.match(windowsSource, /CSC_IDENTITY_AUTO_DISCOVERY = "false"/u);
  assert.match(unixSource, /CSC_IDENTITY_AUTO_DISCOVERY=false/u);
});

test("全部 Actions 固定完整 SHA 并标注版本", async () => {
  const { source } = await loadWorkflow();
  const usesLines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("uses:"));
  assert.ok(usesLines.length > 0);
  for (const line of usesLines) {
    assert.match(
      line,
      /^uses: [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40} # v\d+\.\d+\.\d+$/u,
    );
  }
});

test("Workflow、Job 与 checkout 保持最小权限", async () => {
  const { workflow } = await loadWorkflow();
  const writeJobs = new Set([
    "prepare-release",
    "build",
    "merge-macos-manifest",
    "verify-release",
    "verify-final-release",
    "publish",
  ]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    assert.deepEqual(
      job.permissions,
      { contents: writeJobs.has(jobName) ? "write" : "read" },
      `${jobName} 权限与 Release 操作不匹配`,
    );
    for (const step of job.steps ?? []) {
      if (typeof step.uses === "string" && step.uses.startsWith("actions/checkout@")) {
        assert.equal(
          step.with?.["persist-credentials"],
          false,
          `${jobName} checkout 必须禁用凭据持久化`,
        );
        if (step.with?.path === "web") {
          assert.ok(step.with.ref, `${jobName} 必须检出已解析的 Termous ref`);
        }
      }
    }
  }
});

test("Metadata 在环境审批前固定标签与两个仓库提交", async () => {
  const { workflow } = await loadWorkflow();
  assert.deepEqual(workflow.concurrency, {
    group: "release",
    "cancel-in-progress": false,
  });
  const metadata = workflow.jobs.metadata;
  assert.equal(metadata.environment, undefined);
  assert.equal(metadata.if, undefined);
  assert.equal(workflow.jobs["prepare-release"].needs, "metadata");
  assert.deepEqual(Object.keys(metadata.outputs).sort(), [
    "core_sha",
    "prerelease",
    "release_date",
    "tag",
    "termous_sha",
    "version",
  ]);
  const metadataSource = JSON.stringify(metadata);
  assert.match(metadataSource, /steps\.release\.outputs\.tag/u);
  assert.match(metadataSource, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(metadataSource, /GITHUB_REF_TYPE.*tag/u);
  assert.match(metadataSource, /github\.ref_protected/u);
  assert.match(metadataSource, /REF_PROTECTED/u);
  assert.match(metadataSource, /EVENT_SHA/u);
  assert.match(metadataSource, /github\.sha/u);
  assert.match(metadataSource, /arm64/u);
  assert.match(metadataSource, /数字 prerelease 标识符不能有前导零/u);
  assert.equal(metadataSource.includes("\\+"), false);
  assert.deepEqual(workflow.jobs["prepare-release"].outputs, {
    core_sha: "${{ needs.metadata.outputs.core_sha }}",
    prerelease: "${{ needs.metadata.outputs.prerelease }}",
    release_date: "${{ needs.metadata.outputs.release_date }}",
    tag: "${{ needs.metadata.outputs.tag }}",
    termous_sha: "${{ needs.metadata.outputs.termous_sha }}",
    version: "${{ needs.metadata.outputs.version }}",
  });
});

test("平台构建完成后才使用内置 Token 上传 Draft 资产", async () => {
  const { workflow } = await loadWorkflow();
  const steps = stepsFor(workflow, "build");
  const names = steps.map(({ name }) => name);
  assert.deepEqual(names.slice(-2), [
    "Upload Windows Draft assets",
    "Upload Unix Draft assets",
  ]);
  assert.ok(
    names.indexOf("Create Unix asset receipts") <
      names.indexOf("Upload Unix Draft assets"),
  );
  assert.ok(
    names.indexOf("Package macOS release") <
      names.indexOf("Upload Unix Draft assets"),
  );
  assertBuiltinTokenStep(workflow, "build", "Upload Windows Draft assets");
  assertBuiltinTokenStep(workflow, "build", "Upload Unix Draft assets");
});

test("发布构建固定禁用代码签名且不读取签名 Secrets", async () => {
  const { source, workflow } = await loadWorkflow();
  const buildSteps = stepsFor(workflow, "build");
  for (const name of [
    "Package Windows release",
    "Package macOS release",
  ]) {
    const step = buildSteps.find((candidate) => candidate.name === name);
    assert.ok(step);
  }
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    assert.equal(
      JSON.stringify(job.env ?? {}).includes("${{ secrets."),
      false,
      `${jobName} 不得在 Job env 暴露 Secret`,
    );
    for (const step of job.steps ?? []) {
      if (step.env?.GH_TOKEN !== undefined) {
        assert.equal(step.env.GH_TOKEN, "${{ github.token }}");
      }
    }
  }
  for (const pattern of [
    /TERMOUS_REQUIRE_SIGNING/u,
    /--require-signing/u,
    /CSC_/u,
    /APPLE_API_/u,
    /Authenticode/u,
    /\bcodesign\b/u,
    /\bnotarytool\b/u,
    /\bstapler\b/u,
    /--signature/u,
  ]) {
    assert.doesNotMatch(source, pattern);
  }
});

test("Draft 必须经过合并、双阶段校验和清理后才能公开", async () => {
  const { source, workflow } = await loadWorkflow();
  assert.equal(source.includes("/releases/tags/"), false);
  assert.deepEqual(workflow.jobs["merge-macos-manifest"].needs, [
    "prepare-release",
    "build",
  ]);
  assert.deepEqual(workflow.jobs["verify-release"].needs, [
    "prepare-release",
    "build",
    "merge-macos-manifest",
  ]);
  assert.deepEqual(workflow.jobs["verify-final-release"].needs, [
    "prepare-release",
    "verify-release",
  ]);
  assert.equal(
    workflow.jobs["verify-release"].outputs.content_fingerprint,
    "${{ steps.trusted-assets.outputs.content_fingerprint }}",
  );
  assert.equal(
    workflow.jobs["verify-final-release"].outputs.content_fingerprint,
    "${{ needs.verify-release.outputs.content_fingerprint }}",
  );
  assert.equal(workflow.jobs["verify-final-release"].environment, undefined);
  assert.deepEqual(workflow.jobs.publish.needs, [
    "prepare-release",
    "verify-final-release",
  ]);

  const mergeNames = stepsFor(workflow, "merge-macos-manifest").map(
    ({ name }) => name,
  );
  const mergeDownload = stepsFor(workflow, "merge-macos-manifest").find(
    ({ name }) => name === "Download partial manifests",
  );
  assert.equal(mergeDownload.env.GH_TOKEN, "${{ github.token }}");
  assert.ok(
    mergeNames.indexOf("Download partial manifests") <
      mergeNames.indexOf("Merge canonical macOS manifest"),
  );
  assert.ok(
    mergeNames.indexOf("Merge canonical macOS manifest") <
      mergeNames.indexOf("Replace partial manifests with canonical asset"),
  );
  assert.equal(mergeNames.at(-1), "Replace partial manifests with canonical asset");
  assertBuiltinTokenStep(
    workflow,
    "merge-macos-manifest",
    "Replace partial manifests with canonical asset",
  );

  const verifyNames = stepsFor(workflow, "verify-release").map(({ name }) => name);
  const receiptDownload = stepsFor(workflow, "verify-release").find(
    ({ name }) => name === "Download Draft evidence",
  );
  assert.equal(receiptDownload.env.GH_TOKEN, "${{ github.token }}");
  assert.match(receiptDownload.run, /release-json/u);
  assert.match(receiptDownload.run, /release\.receipts\.json/u);
  assert.ok(verifyNames.includes("Verify manifests, receipts and digests"));
  assert.ok(
    verifyNames.indexOf("Verify manifests, receipts and digests") <
      verifyNames.indexOf("Delete temporary receipts"),
  );
  assert.equal(verifyNames.at(-1), "Delete temporary receipts");
  assertBuiltinTokenStep(workflow, "verify-release", "Delete temporary receipts");

  const finalNames = stepsFor(workflow, "verify-final-release").map(
    ({ name }) => name,
  );
  assert.equal(finalNames.at(-1), "Verify final public asset set");
  const finalVerification = stepsFor(workflow, "verify-final-release").at(-1);
  assert.equal(finalVerification.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    finalVerification.env.TRUSTED_CONTENT_FINGERPRINT,
    "${{ needs.verify-release.outputs.content_fingerprint }}",
  );
  assert.match(finalVerification.run, /--github-repository/u);
  assert.match(finalVerification.run, /--token-env GH_TOKEN/u);
  assert.match(finalVerification.run, /TRUSTED_CONTENT_FINGERPRINT/u);
  assert.equal(
    JSON.stringify(workflow.jobs["verify-final-release"]).includes(
      "create-github-app-token",
    ),
    false,
  );
  assert.equal(
    stepsFor(workflow, "prepare-release").at(-1)?.name,
    "Create or update Draft Release",
  );
  assertBuiltinTokenStep(
    workflow,
    "prepare-release",
    "Create or update Draft Release",
  );
  const publishSteps = stepsFor(workflow, "publish");
  const approvedVerification = publishSteps.find(
    ({ name }) => name === "Re-verify final Draft after environment approval",
  );
  assert.equal(workflow.jobs.publish.environment, "release");
  assert.equal(approvedVerification.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    approvedVerification.env.TRUSTED_CONTENT_FINGERPRINT,
    "${{ needs.verify-final-release.outputs.content_fingerprint }}",
  );
  assert.match(approvedVerification.run, /contentFingerprint/u);
  assert.match(approvedVerification.run, /releaseFingerprint/u);
  assert.ok(
    publishSteps.indexOf(approvedVerification) <
      publishSteps.findIndex(({ name }) => name === "Publish verified Draft Release"),
  );
  const publishStep = publishSteps.at(-1);
  assert.equal(publishStep.name, "Publish verified Draft Release");
  assertBuiltinTokenStep(workflow, "publish", "Publish verified Draft Release");
  assert.match(publishStep.run, /resolve_tag_commit/u);
  assert.match(publishStep.run, /git\/ref\/tags\/\$TAG/u);
  assert.match(publishStep.run, /EXPECTED_COMMIT/u);
  assert.match(publishStep.run, /EXPECTED_FINGERPRINT/u);
  assert.match(publishStep.run, /release-json/u);
  assert.match(
    publishStep.run,
    /current_snapshot[\s\S]*printf '%s' "\$current_snapshot"[\s\S]*sha256sum/u,
  );
  assert.match(publishStep.run, /current_fingerprint/u);
  assert.match(publishStep.run, /releases\/\$release_id/u);
  assert.match(publishStep.run, /-F draft=false/u);
  assert.equal(publishStep.run.includes('gh release edit "$TAG"'), false);
});

test("每类 Draft 资产写操作前都重新确认 Release 状态", async () => {
  const { workflow } = await loadWorkflow();
  const sourceFor = (jobName, stepName) =>
    stepsFor(workflow, jobName).find(({ name }) => name === stepName)?.run ?? "";
  assert.match(
    sourceFor("build", "Upload Windows Draft assets"),
    /isDraft[\s\S]*gh release upload/u,
  );
  assert.match(
    sourceFor("build", "Upload Unix Draft assets"),
    /assert_draft[\s\S]*gh release upload/u,
  );
  const mergeSource = sourceFor(
    "merge-macos-manifest",
    "Replace partial manifests with canonical asset",
  );
  assert.equal((mergeSource.match(/assert_draft/g) ?? []).length, 4);
  const cleanupSource = sourceFor("verify-release", "Delete temporary receipts");
  assert.match(cleanupSource, /for receipt[\s\S]*isDraft[\s\S]*delete-asset/u);
});
