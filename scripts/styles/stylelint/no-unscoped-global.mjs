import selectorParser from "postcss-selector-parser";
import stylelint from "stylelint";

export const ruleName = "termous/no-unscoped-global";
export const messages = stylelint.utils.ruleMessages(ruleName, {
  globalRejected:
    "CSS Modules 中的 :global 必须由同一分支前方或可证明安全的祖先本地 class 限定作用域，且不能嵌套在其他伪类中。",
  parseRejected: "CSS Modules 选择器无法静态分析，不能确认其局部作用域。",
  unscoped:
    "CSS Modules 中的每个选择器分支必须由本地 class 或可证明安全的祖先限定作用域。",
});

const scopePreservingAtRules = new Set([
  "container",
  "layer",
  "media",
  "supports",
]);
const selectorProcessor = selectorParser();

function pseudoName(node) {
  return node.value.toLowerCase();
}

function isFunctionalPseudo(node) {
  return Array.isArray(node.nodes);
}

function pseudoProvidesLocalScope(node) {
  const name = pseudoName(node);
  if (
    !isFunctionalPseudo(node) ||
    (name !== ":is" && name !== ":local" && name !== ":where") ||
    node.nodes.length === 0
  ) {
    return false;
  }
  return node.nodes.every(
    (selector) =>
      selector.type === "selector" && selectorHasDirectLocalScope(selector),
  );
}

function nodeProvidesLocalScope(node) {
  return (
    node.type === "class" ||
    (node.type === "pseudo" && pseudoProvidesLocalScope(node))
  );
}

function selectorHasDirectLocalScope(selector) {
  return selector.nodes.some(nodeProvidesLocalScope);
}

function parseSelector(selector) {
  return selectorProcessor.astSync(selector);
}

function allSelectorBranchesHaveDirectLocalScope(selector) {
  const root = parseSelector(selector);
  return (
    root.nodes.length > 0 &&
    root.nodes.every(
      (branch) =>
        branch.type === "selector" && selectorHasDirectLocalScope(branch),
    )
  );
}

function isScopePreservingAtRule(node) {
  return scopePreservingAtRules.has(node.name.toLowerCase());
}

function hasSafelyScopedAncestor(rule) {
  const ancestors = [];
  let ancestor = rule.parent;
  while (ancestor) {
    if (ancestor.type === "rule" || ancestor.type === "atrule") {
      ancestors.push(ancestor);
    }
    ancestor = ancestor.parent;
  }

  let scoped = false;
  for (const node of ancestors.reverse()) {
    if (node.type === "atrule") {
      if (!isScopePreservingAtRule(node)) {
        scoped = false;
      }
      continue;
    }
    if (scoped) {
      continue;
    }
    try {
      scoped = allSelectorBranchesHaveDirectLocalScope(node.selector);
    } catch {
      scoped = false;
    }
  }
  return scoped;
}

function isInsideKeyframes(rule) {
  let ancestor = rule.parent;
  while (ancestor) {
    if (
      ancestor.type === "atrule" &&
      /(?:^|-)keyframes$/iu.test(ancestor.name)
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

function hasPseudoAncestor(node) {
  let ancestor = node.parent;
  while (ancestor) {
    if (ancestor.type === "pseudo") {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

function inspectSelectorBranch(selector, ancestorScoped) {
  const globalViolations = new Set();
  let scopedBefore = ancestorScoped;

  for (const node of selector.nodes) {
    if (node.type === "pseudo" && pseudoName(node) === ":global") {
      if (!isFunctionalPseudo(node) || !scopedBefore) {
        globalViolations.add(node);
      }
    } else if (nodeProvidesLocalScope(node)) {
      scopedBefore = true;
    }
  }

  selector.walkPseudos((node) => {
    if (pseudoName(node) === ":global" && hasPseudoAncestor(node)) {
      globalViolations.add(node);
    }
  });

  return {
    branchScoped: ancestorScoped || selectorHasDirectLocalScope(selector),
    globalViolations: [...globalViolations],
  };
}

function reportAtNode({ message, node, result, rule }) {
  const index = Number.isInteger(node.sourceIndex) ? node.sourceIndex : 0;
  const length = Math.max(1, node.toString().length);
  stylelint.utils.report({
    endIndex: Math.min(rule.selector.length, index + length),
    index,
    message,
    node: rule,
    result,
    ruleName,
  });
}

const ruleFunction = (primaryOption) => (root, result) => {
  const validOptions = stylelint.utils.validateOptions(result, ruleName, {
    actual: primaryOption,
    possible: [true],
  });
  if (!validOptions) {
    return;
  }

  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) {
      return;
    }

    let selectorRoot;
    try {
      selectorRoot = parseSelector(rule.selector);
    } catch {
      stylelint.utils.report({
        index: 0,
        message: messages.parseRejected,
        node: rule,
        result,
        ruleName,
      });
      return;
    }

    const ancestorScoped = hasSafelyScopedAncestor(rule);
    for (const selector of selectorRoot.nodes) {
      if (selector.type !== "selector") {
        continue;
      }
      const inspection = inspectSelectorBranch(selector, ancestorScoped);
      for (const globalNode of inspection.globalViolations) {
        reportAtNode({
          message: messages.globalRejected,
          node: globalNode,
          result,
          rule,
        });
      }
      if (!inspection.branchScoped && inspection.globalViolations.length === 0) {
        reportAtNode({
          message: messages.unscoped,
          node: selector,
          result,
          rule,
        });
      }
    }
  });
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

export default stylelint.createPlugin(ruleName, ruleFunction);
