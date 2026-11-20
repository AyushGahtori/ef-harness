import { JsonParseError } from "./errors.js";

export function parseStrictJson(source: string, filePath: string): unknown {
  const parser = new JsonParser(source, filePath);
  const value = parser.parseValue();
  parser.finish();
  return value;
}

class JsonParser {
  private index = 0;
  private line = 1;

  constructor(
    private readonly source: string,
    private readonly filePath: string,
  ) {}

  atEnd(): boolean {
    return this.index >= this.source.length;
  }

  finish(): void {
    this.skipWhitespace();
    if (!this.atEnd()) this.fail("Unexpected trailing JSON content");
  }

  parseValue(): unknown {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === "{") return this.parseObject();
    if (ch === "[") return this.parseArray();
    if (ch === '"') return this.parseString();
    if (ch === "t") return this.parseLiteral("true", true);
    if (ch === "f") return this.parseLiteral("false", false);
    if (ch === "n") return this.parseLiteral("null", null);
    if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) return this.parseNumber();
    this.fail("Malformed JSON value");
  }

  fail(message: string): never {
    throw new JsonParseError(`${message} at line ${this.line} in ${this.filePath}`, {
      filePath: this.filePath,
      line: this.line,
    });
  }

  private parseObject(): Record<string, unknown> {
    this.expect("{");
    const record: Record<string, unknown> = {};
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.peek() === "}") {
      this.expect("}");
      return record;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== '"') this.fail("JSON object key must be a string");
      const keyLine = this.line;
      const key = this.parseString();
      if (keys.has(key)) {
        throw new JsonParseError(
          `Duplicate JSON key "${key}" at line ${keyLine} in ${this.filePath}`,
          { filePath: this.filePath, line: keyLine },
        );
      }
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      record[key] = this.parseValue();
      this.skipWhitespace();
      const next = this.peek();
      if (next === ",") {
        this.expect(",");
        continue;
      }
      if (next === "}") {
        this.expect("}");
        return record;
      }
      this.fail("Malformed JSON object");
    }
  }

  private parseArray(): unknown[] {
    this.expect("[");
    const items: unknown[] = [];
    this.skipWhitespace();
    if (this.peek() === "]") {
      this.expect("]");
      return items;
    }
    for (;;) {
      items.push(this.parseValue());
      this.skipWhitespace();
      const next = this.peek();
      if (next === ",") {
        this.expect(",");
        continue;
      }
      if (next === "]") {
        this.expect("]");
        return items;
      }
      this.fail("Malformed JSON array");
    }
  }

  private parseString(): string {
    this.expect('"');
    let out = "";
    while (!this.atEnd()) {
      const ch = this.next();
      if (ch === '"') return out;
      if (ch === "\\") {
        const esc = this.next();
        if (esc === '"') out += '"';
        else if (esc === "\\") out += "\\";
        else if (esc === "/") out += "/";
        else if (esc === "b") out += "\b";
        else if (esc === "f") out += "\f";
        else if (esc === "n") out += "\n";
        else if (esc === "r") out += "\r";
        else if (esc === "t") out += "\t";
        else if (esc === "u") {
          const hex = this.source.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("Malformed JSON unicode escape");
          out += String.fromCharCode(Number.parseInt(hex, 16));
          this.index += 4;
        } else this.fail("Malformed JSON string escape");
        continue;
      }
      if (ch === "\n") this.fail("Unterminated JSON string");
      out += ch;
    }
    this.fail("Unterminated JSON string");
  }

  private parseLiteral(text: string, value: unknown): unknown {
    if (this.source.slice(this.index, this.index + text.length) !== text) {
      this.fail(`Malformed JSON literal`);
    }
    this.index += text.length;
    return value;
  }

  private parseNumber(): number {
    const start = this.index;
    if (this.peek() === "-") this.next();
    if (this.peek() === "0") this.next();
    else if (this.peek() !== undefined && this.peek()! >= "1" && this.peek()! <= "9") {
      while (this.peek() !== undefined && this.peek()! >= "0" && this.peek()! <= "9") this.next();
    } else this.fail("Malformed JSON number");
    if (this.peek() === ".") {
      this.next();
      if (this.peek() === undefined || this.peek()! < "0" || this.peek()! > "9") {
        this.fail("Malformed JSON number");
      }
      while (this.peek() !== undefined && this.peek()! >= "0" && this.peek()! <= "9") this.next();
    }
    if (this.peek() === "e" || this.peek() === "E") {
      this.next();
      if (this.peek() === "+" || this.peek() === "-") this.next();
      if (this.peek() === undefined || this.peek()! < "0" || this.peek()! > "9") {
        this.fail("Malformed JSON number");
      }
      while (this.peek() !== undefined && this.peek()! >= "0" && this.peek()! <= "9") this.next();
    }
    const lexeme = this.source.slice(start, this.index);
    const parsed: unknown = JSON.parse(lexeme);
    if (typeof parsed !== "number") this.fail("Malformed JSON number");
    return parsed;
  }

  private skipWhitespace(): void {
    while (!this.atEnd()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.next();
        continue;
      }
      if (ch === "\n") {
        this.next();
        continue;
      }
      break;
    }
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) this.fail(`Expected ${ch}`);
    this.next();
  }

  private peek(): string | undefined {
    return this.source[this.index];
  }

  private next(): string {
    const ch = this.source[this.index];
    if (ch === undefined) this.fail("Unexpected end of JSON");
    this.index += 1;
    if (ch === "\n") this.line += 1;
    return ch;
  }
}
