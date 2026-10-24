import type { TextMatchTransformer } from "@lexical/markdown";

import {
  $createEquationNode,
  $isEquationNode,
  EquationNode,
} from "../nodes/equation-node";

/*
 * `$...$` is inline math only when it looks like math, as in Pandoc: the
 * opening `$` has a non-space right after it and no letter or digit right
 * before it, and the closing `$` has a non-space right before it and no
 * letter or digit right after it. Without this, prose with dollar signs —
 * `sign: "$" (shows $633, $56.97)`, or two `routes/$id` paths on one line —
 * was swallowed into an "equation" and rendered as broken KaTeX.
 */
const OPEN = String.raw`(?<![\w$])\$(?=\S)`;
const BODY = String.raw`([^$]*?\S)`;
const CLOSE = String.raw`\$`;

export const EQUATION: TextMatchTransformer = {
  dependencies: [EquationNode],
  export: (node) => {
    if (!$isEquationNode(node)) {
      return null;
    }

    return `$${node.getEquation()}$`;
  },
  importRegExp: new RegExp(`${OPEN}${BODY}${CLOSE}(?![\\w$])`),
  // While typing, nothing follows the closing `$` yet.
  regExp: new RegExp(`${OPEN}${BODY}${CLOSE}$`),
  replace: (textNode, match) => {
    const [, equation] = match;
    const equationNode = $createEquationNode(equation, true);
    textNode.replace(equationNode);
  },
  trigger: "$",
  type: "text-match",
};
