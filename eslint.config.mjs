import path from "node:path";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import { DAG_RANK } from "./scripts/layers.mjs";

const SOURCE_GLOBS = [
  "packages/**/*.ts",
  "apps/**/*.ts",
  "spikes/**/*.ts",
  "corpus/**/*.ts",
  "benchmarks/**/*.ts",
  "tests/**/*.ts",
];

function workspaceId(filename) {
  const normalized = filename.replaceAll("\\", "/");
  const pkg = normalized.match(/\/packages\/([^/]+)\//);
  if (pkg) return pkg[1] ?? null;
  const app = normalized.match(/\/apps\/([^/]+)\//);
  if (app) return app[1] ?? null;
  if (normalized.includes("/spikes/")) return "spikes";
  if (normalized.includes("/corpus/")) return "corpus";
  if (normalized.includes("/benchmarks/")) return "benchmarks";
  if (normalized.includes("/tests/e2e/")) return "e2e";
  return null;
}

const layerBoundary = {
  meta: {
    type: "problem",
    docs: { description: "Keep workspace imports on the layer DAG and public barrels." },
    schema: [],
    messages: {
      deep: "Import {{spec}} bypasses the package barrel src/index.ts.",
      upward: "Layer {{from}} cannot import {{spec}} (layer {{to}}).",
      unknown: "Unknown workspace package in import {{spec}}.",
    },
  },
  create(context) {
    const sourceId = workspaceId(context.filename);
    function check(spec, node) {
      if (typeof spec !== "string" || !sourceId) return;
      if (spec.startsWith("@ef-harness/")) {
        const rest = spec.slice("@ef-harness/".length);
        const [id, ...extra] = rest.split("/");
        if (!id || DAG_RANK[id] === undefined) {
          context.report({ node, messageId: "unknown", data: { spec } });
          return;
        }
        if (extra.length > 0) {
          context.report({ node, messageId: "deep", data: { spec } });
          return;
        }
        const from = DAG_RANK[sourceId];
        const to = DAG_RANK[id];
        if (from === undefined || to === undefined || to >= from) {
          context.report({
            node,
            messageId: "upward",
            data: { spec, from: String(from), to: String(to) },
          });
        }
        return;
      }
      if (!spec.startsWith(".")) return;
      const resolved = path.resolve(path.dirname(context.filename), spec).replaceAll("\\", "/");
      const targetId = workspaceId(`${resolved}/file`);
      if (!targetId || targetId === sourceId) return;
      const from = DAG_RANK[sourceId];
      const to = DAG_RANK[targetId];
      if (from === undefined || to === undefined || to >= from) {
        context.report({
          node,
          messageId: "upward",
          data: { spec, from: String(from), to: String(to) },
        });
      }
    }
    return {
      ImportDeclaration(node) {
        check(node.source.value, node.source);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node.source.value, node.source);
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.sql",
      "**/*.mmd",
      "**/*.svg",
      "**/*.md",
      "schema/**",
      "tools/**",
      "research/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: SOURCE_GLOBS,
    plugins: {
      import: importPlugin,
      ef: { rules: { "layer-boundary": layerBoundary } },
    },
    rules: {
      "no-empty": "error",
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "xxx"], location: "anywhere" }],
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "import/no-cycle": ["error", { maxDepth: 10, ignoreExternal: true }],
      "ef/layer-boundary": "error",
    },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.mjs"],
    plugins: {
      ef: { rules: { "layer-boundary": layerBoundary } },
    },
    rules: {
      "no-empty": "error",
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "xxx"], location: "anywhere" }],
      "ef/layer-boundary": "error",
    },
  },
);
