import { KB_TEXT_CHARS } from "./model-profile.js";
import { oneLineSummary } from "./one-line-summary.js";
import { wrapData } from "./provenance.js";
import type { SecretRedactorPort } from "./secret-redactor.js";

export interface KbNodeView {
  readonly id: string;
  readonly version: string;
  readonly text: string;
}

export interface ShrunkKbOutput {
  readonly text: string;
  readonly oneLine: string;
  readonly omittedChars: number;
}

export function shrinkKbOutput(node: KbNodeView, redactor: SecretRedactorPort): ShrunkKbOutput {
  const omittedChars = Math.max(0, node.text.length - KB_TEXT_CHARS);
  const body = omittedChars > 0 ? node.text.slice(0, KB_TEXT_CHARS) : node.text;
  const note = omittedChars > 0 ? `\n${omittedChars} characters omitted` : "";
  const inner = `${node.id}@${node.version}\n${body}${note}`;
  return {
    omittedChars,
    oneLine: oneLineSummary({ kind: "kb", id: node.id, version: node.version }),
    text: wrapData({
      source: `kb:${node.id}@${node.version}`,
      trust: "kb",
      body: inner,
      redactor,
    }),
  };
}
