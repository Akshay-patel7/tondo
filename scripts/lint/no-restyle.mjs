// Follows @shadcn/lint's no-restyle rule (https://github.com/shadcn-ui/lint):
// a ui component owns its look, so code that renders one picks a variant or a
// size and passes only layout classes. @shadcn/lint recognizes ui components
// by import alias or a components.json, and Tondo imports them by relative
// path with neither, so this rule resolves each relative import and checks
// whether it lands in the ui folder. Layout means what @shadcn/lint's "layout"
// category allows: display, position, size, margin, flex and grid placement,
// alignment, overflow, transforms and interaction.
import path from "node:path";

const LAYOUT = [
  /^(block|inline|inline-block|inline-flex|inline-grid|inline-table|flex|grid|contents|flow-root|hidden|list-item|container)$/,
  /^(table|sr-only|not-sr-only|visible|invisible|collapse|isolate|isolation-auto)(-.+)?$/,
  /^(static|fixed|absolute|relative|sticky)$/,
  /^(box-border|box-content|box-decoration-.+|float-.+|clear-.+)$/,
  /^-?(inset(-[xy])?-(?!shadow|ring)|start-|end-|top-|right-|bottom-|left-|z-)/,
  /^-?m(x|y|s|e|t|r|b|l|bs|be)?-/,
  /^(size|w|min-w|max-w|h|min-h|max-h)-/,
  /^-?(basis|grow|shrink|order)(-|$)/,
  /^(flex-|grid-(cols|rows|flow)-|auto-(cols|rows)-)/,
  /^-?(col|row)-/,
  /^(justify|items|self|place|content)-/,
  /^(overflow|overscroll|object|aspect|columns|break|whitespace|wrap|caption|contain)-/,
  /^text-(left|center|right|justify|start|end)$/,
  /^align-(baseline|top|middle|bottom|text-top|text-bottom|sub|super)$/,
  /^border-(collapse|separate)$/,
  /^-?(rotate|scale|skew|translate)(-|$)/,
  /^(transform|origin|perspective|backface)(-|$)/,
  /^(cursor|pointer-events|select|touch|resize|appearance|scheme|field-sizing|will-change|snap|scroll|scrollbar|forced-color-adjust)(-|$)/,
  /^@container/,
  /^(group|peer)(\/.+)?$/,
  // Tondo's window drag regions, from index.css, change behavior, not look.
  /^app-(no-)?drag$/,
];

/** The utility without its variants (hover:, data-[x]:) or its ! for important. */
function utilityOf(cls) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i += 1) {
    const char = cls[i];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) start = i + 1;
  }
  return cls.slice(start).replace(/^!|!$/g, "");
}

function isLayout(cls) {
  const utility = utilityOf(cls);
  return LAYOUT.some((pattern) => pattern.test(utility));
}

/**
 * The class strings an expression can produce: string literals, both branches
 * of a ternary, the right side of &&, nothing for null, undefined or a boolean,
 * and template literals whose ${} parts stand between spaces, so no class is
 * half text and half expression. Null means the rule can't tell.
 */
function staticClasses(node) {
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") return [node.value];
      return node.value === null || typeof node.value === "boolean" ? [] : null;
    case "TemplateLiteral": {
      const texts = node.quasis.map((quasi) => quasi.value.cooked);
      const classes = [...texts];
      const last = node.expressions.length - 1;
      for (const [i, expression] of node.expressions.entries()) {
        const before = texts[i];
        const after = texts[i + 1];
        const spacedBefore = (i === 0 && before === "") || /\s$/.test(before);
        const spacedAfter = (i === last && after === "") || /^\s/.test(after);
        const inner = spacedBefore && spacedAfter ? staticClasses(expression) : null;
        if (!inner) return null;
        classes.push(...inner);
      }
      return classes;
    }
    case "Identifier":
      return node.name === "undefined" ? [] : null;
    case "ConditionalExpression": {
      const consequent = staticClasses(node.consequent);
      const alternate = staticClasses(node.alternate);
      return consequent && alternate ? [...consequent, ...alternate] : null;
    }
    case "LogicalExpression":
      return node.operator === "&&" ? staticClasses(node.right) : null;
    case "JSXExpressionContainer":
      return staticClasses(node.expression);
    default:
      return null;
  }
}

function rootName(name) {
  let node = name;
  while (node.type === "JSXMemberExpression") node = node.object;
  return node.type === "JSXIdentifier" ? node.name : null;
}

const noRestyle = {
  meta: {
    type: "problem",
    docs: {
      description:
        "ui components own their look: pick a variant or size, and pass only layout classes.",
    },
    messages: {
      restyle:
        '"{{cls}}" is not allowed on <{{name}}>: ui components own their look. Pick a variant or size, or put the class on a parent element.',
      dynamic:
        "<{{name}}> gets a className this rule can't read. Pass a string of layout classes, or a ternary of them.",
    },
    schema: [
      {
        type: "object",
        properties: { ui: { type: "string" } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const cwd = context.cwd ?? process.cwd();
    const uiDir = path.resolve(cwd, context.options[0]?.ui ?? "src/renderer/ui");
    const fileDir = path.dirname(path.resolve(cwd, context.filename));
    const uiNames = new Set();

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (node.importKind === "type" || !source.startsWith(".")) return;
        const target = path.resolve(fileDir, source);
        if (target !== uiDir && !target.startsWith(uiDir + path.sep)) return;
        for (const specifier of node.specifiers) {
          if (specifier.importKind !== "type") uiNames.add(specifier.local.name);
        }
      },
      JSXOpeningElement(node) {
        const name = rootName(node.name);
        if (!name || !uiNames.has(name)) return;
        const attribute = node.attributes.find(
          (a) => a.type === "JSXAttribute" && a.name.name === "className",
        );
        if (!attribute?.value) return;
        const label = context.sourceCode.getText(node.name);
        const classes = staticClasses(attribute.value);
        if (!classes) {
          context.report({ node: attribute, messageId: "dynamic", data: { name: label } });
          return;
        }
        for (const cls of classes.flatMap((text) => text.split(/\s+/))) {
          if (cls && !isLayout(cls)) {
            context.report({ node: attribute, messageId: "restyle", data: { cls, name: label } });
          }
        }
      },
    };
  },
};

export default { meta: { name: "tondo" }, rules: { "no-restyle": noRestyle } };
