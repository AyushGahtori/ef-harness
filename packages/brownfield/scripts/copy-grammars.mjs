import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "grammars");
const destination = path.join(root, "dist", "grammars");
const files = [
  "tree-sitter-javascript.wasm",
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
];

fs.mkdirSync(destination, { recursive: true });
for (const fileName of files) {
  const source = path.join(sourceDir, fileName);
  if (!fs.existsSync(source)) {
    throw new Error(`missing tree-sitter grammar ${source}`);
  }
  fs.copyFileSync(source, path.join(destination, fileName));
}
