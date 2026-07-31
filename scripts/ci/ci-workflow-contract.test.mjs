import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseDocument } from "yaml";

const workflowUrl = new URL("../../.github/workflows/ci.yml", import.meta.url);
const releaseWorkflowUrl = new URL(
  "../../.github/workflows/release.yml",
  import.meta.url,
);

async function loadWorkflow(url = workflowUrl, name = "CI") {
  const source = await readFile(url, "utf8");
  const document = parseDocument(source, {
    maxAliasCount: 0,
    strict: true,
    uniqueKeys: true,
  });
  assert.deepEqual(
    document.errors.map(({ message }) => message),
    [],
    `${name} workflow 必须是合法且无重复键的 YAML`,
  );
  return { source, workflow: document.toJS({ maxAliasCount: 0 }) };
}

function stepsFor(workflow, jobName) {
  const steps = workflow.jobs?.[jobName]?.steps;
  assert.ok(Array.isArray(steps), `${jobName} 必须定义 steps`);
  return steps;
}

function normalizeBuildStep(step) {
  const normalized = structuredClone(step);
  if (
    normalized.name === "Checkout Termous"
    || normalized.name === "Checkout pinned Termous Core"
  ) {
    delete normalized.with.ref;
  }
  if (normalized.name === "Setup pnpm") {
    delete normalized.with.cache;
  }
  if (normalized.name === "Setup Node.js") {
    delete normalized.with.cache;
    delete normalized.with["cache-dependency-path"];
    delete normalized.with["package-manager-cache"];
  }
  if (normalized.name === "Setup Go") {
    delete normalized.with.cache;
    delete normalized.with["cache-dependency-path"];
  }
  return normalized;
}

test("全部前端分支 push 都会触发 CI", async () => {
  const { workflow } = await loadWorkflow();
  assert.deepEqual(workflow.on.push.branches, ["**"]);
  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
});

test("Core 优先使用前端同名分支并在缺失时回退 main", async () => {
  const { workflow } = await loadWorkflow();
  const resolver = workflow.jobs["resolve-core"];
  const resolverStep = stepsFor(workflow, "resolve-core").find(
    ({ name }) => name === "Resolve matching branch or main",
  );
  assert.ok(resolverStep);
  const script = resolverStep.run;

  assert.equal(
    resolver.if,
    "github.repository == 'Countra/termous' && "
      + "github.ref_type == 'branch' && "
      + "(github.event_name == 'push' || "
      + "github.event_name == 'workflow_dispatch')",
  );
  assert.equal(resolverStep.env.FRONTEND_BRANCH, "${{ github.ref_name }}");
  assert.equal(resolverStep.env.DEFAULT_CORE_BRANCH, "main");
  assert.match(script, /matching: ref/u);
  assert.match(script, /fallback: ref/u);
  assert.match(
    script,
    /matchingRef="refs\/heads\/\$FRONTEND_BRANCH"/u,
  );
  assert.match(
    script,
    /fallbackRef="refs\/heads\/\$DEFAULT_CORE_BRANCH"/u,
  );
  assert.match(script, /缺少读取 Termous Core/u);
  assert.match(script, /查询 Termous Core 分支失败/u);
  assert.match(script, /\.errors/u);
  assert.match(script, /\.data\.repository/u);
  assert.match(script, /\^\[0-9a-f\]\{40\}\$/u);
  assert.ok(
    script.indexOf('if [[ -n "$graphql_errors" ]]')
      < script.indexOf('if [[ -n "$matching_sha" ]]'),
    "GraphQL 错误必须在分支回退前失败",
  );
  assert.deepEqual(resolver.outputs, {
    sha: "${{ steps.core.outputs.sha }}",
  });

  const coreCheckout = stepsFor(workflow, "build").find(
    ({ name }) => name === "Checkout pinned Termous Core",
  );
  assert.ok(coreCheckout);
  assert.equal(coreCheckout.with.repository, "Countra/termous-core");
  assert.equal(coreCheckout.with.ref, "${{ needs.resolve-core.outputs.sha }}");
  assert.equal(
    coreCheckout.with.token,
    "${{ secrets.TERMOUS_CORE_READ_TOKEN }}",
  );
  assert.equal(coreCheckout.with["persist-credentials"], false);
});

test("提交构建复用 Release 的四平台打包路径", async () => {
  const { workflow } = await loadWorkflow();
  const { workflow: releaseWorkflow } = await loadWorkflow(
    releaseWorkflowUrl,
    "Release",
  );
  const build = workflow.jobs.build;
  const releaseBuild = releaseWorkflow.jobs.build;

  assert.equal(build.needs, "resolve-core");
  assert.deepEqual(build.strategy, releaseBuild.strategy);
  for (const name of [
    "TERMOUS_ARCH",
    "TERMOUS_CORE_DIR",
    "TERMOUS_OUTPUT_DIR",
    "TERMOUS_TARGET_OS",
    "TERMOUS_WEB_DIR",
  ]) {
    assert.equal(build.env[name], releaseBuild.env[name], `${name} 必须与 Release 一致`);
  }
  assert.equal(build.env.TERMOUS_VERSION, "0.0.0-ci");
  assert.equal(build.env.TERMOUS_RELEASE_TAG, undefined);

  const releaseSteps = stepsFor(releaseWorkflow, "build");
  const lastBuildStep = releaseSteps.findIndex(
    ({ name }) => name === "Package macOS release",
  );
  assert.ok(lastBuildStep >= 0);
  const releaseBuildSteps = releaseSteps.slice(0, lastBuildStep + 1);
  const steps = stepsFor(workflow, "build");
  assert.deepEqual(
    steps.map(normalizeBuildStep),
    releaseBuildSteps.map(normalizeBuildStep),
    "除 ref 与缓存配置外，提交构建步骤必须与 Release 完全一致",
  );

  const frontendCheckout = steps.find(
    ({ name }) => name === "Checkout Termous",
  );
  assert.ok(frontendCheckout);
  assert.equal(frontendCheckout.with.ref, "${{ github.sha }}");

  const coreCheckout = steps.find(
    ({ name }) => name === "Checkout pinned Termous Core",
  );
  assert.ok(coreCheckout);
  assert.equal(coreCheckout.with.ref, "${{ needs.resolve-core.outputs.sha }}");

  const pnpmStep = steps.find(({ name }) => name === "Setup pnpm");
  assert.ok(pnpmStep);
  assert.equal(pnpmStep.with.cache, false);

  const nodeStep = steps.find(({ name }) => name === "Setup Node.js");
  assert.ok(nodeStep);
  assert.equal(nodeStep.with["package-manager-cache"], false);
  assert.equal(nodeStep.with.cache, undefined);

  const goStep = steps.find(({ name }) => name === "Setup Go");
  assert.ok(goStep);
  assert.equal(goStep.with.cache, false);
});

test("提交构建只读且不使用 GitHub Storage", async () => {
  const { workflow } = await loadWorkflow();
  const buildScope = JSON.stringify({
    build: workflow.jobs.build,
    resolver: workflow.jobs["resolve-core"],
  });

  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const forbidden of [
    "actions/cache",
    "actions/upload-artifact",
    "actions/download-artifact",
    "cache-dependency-path",
    "cache_dependency_path",
    "gh release",
    "environment: release",
    "contents: write",
  ]) {
    assert.equal(buildScope.includes(forbidden), false, `禁止出现 ${forbidden}`);
  }

  for (const job of [workflow.jobs["resolve-core"], workflow.jobs.build]) {
    assert.equal(job.environment, undefined);
    for (const step of job.steps ?? []) {
      if (
        typeof step.uses === "string"
        && step.uses.startsWith("actions/checkout@")
      ) {
        assert.equal(step.with?.["persist-credentials"], false);
      }
    }
  }

  for (const step of stepsFor(workflow, "build")) {
    if (step.name === "Setup pnpm") {
      assert.equal(step.with?.cache, false);
    }
    if (step.name === "Setup Node.js") {
      assert.equal(step.with?.["package-manager-cache"], false);
      assert.equal(step.with?.cache, undefined);
    }
    if (step.name === "Setup Go") {
      assert.equal(step.with?.cache, false);
    }
  }
});
