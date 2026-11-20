import { LOCAL_PORTS } from "./types.js";

/**
 * Structural stand-in for Task 083's in-process Mermaid parser.
 * Swap this for the real parser when that branch is integrated.
 */
export const MERMAID_PARSER_SOURCE = LOCAL_PORTS.mermaidParser;

export function mermaidIssues(diagram: string, kind: "sequence" | "state"): string[] {
  const issues: string[] = [];
  const lines = diagram
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("%%"));
  if (lines.length === 0) {
    return ["diagram is empty"];
  }
  const header = lines[0] ?? "";
  if (kind === "sequence" && header !== "sequenceDiagram") {
    issues.push("sequence diagram must start with sequenceDiagram");
  }
  if (kind === "state" && header !== "stateDiagram-v2" && header !== "stateDiagram") {
    issues.push("state diagram must start with stateDiagram-v2");
  }
  const body = lines.slice(1).join("\n");
  if (kind === "sequence" && !/(->>|-->>|->)/.test(body)) {
    issues.push("sequence diagram has no messages");
  }
  if (kind === "state" && !/-->/.test(body)) {
    issues.push("state diagram has no transitions");
  }
  issues.push(...unquotedParenLabels(diagram));
  if (!bracketsBalanced(diagram)) issues.push("diagram has unbalanced brackets");
  return issues;
}

function unquotedParenLabels(diagram: string): string[] {
  const issues: string[] = [];
  let index = 0;
  while (index < diagram.length) {
    const open = diagram.indexOf("[", index);
    if (open < 0) break;
    const close = diagram.indexOf("]", open + 1);
    if (close < 0) break;
    const content = diagram.slice(open + 1, close);
    const quoted = content.startsWith('"') || content.startsWith("'");
    if (!quoted && (content.includes("(") || content.includes(")"))) {
      issues.push(`unquoted parentheses in node label [${content}]`);
    }
    index = close + 1;
  }
  return issues;
}

function bracketsBalanced(diagram: string): boolean {
  const pairs: Record<string, string> = { "[": "]", "(": ")", "{": "}" };
  const stack: string[] = [];
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < diagram.length; index += 1) {
    const char = diagram[index];
    if (!char) continue;
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (pairs[char]) {
      stack.push(pairs[char]);
      continue;
    }
    if (char === "]" || char === ")" || char === "}") {
      if (stack.pop() !== char) return false;
    }
  }
  return stack.length === 0 && quote === null;
}
