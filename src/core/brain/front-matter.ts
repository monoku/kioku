import { Document, isMap, isScalar, parseDocument, Scalar, YAMLSeq } from "yaml";

/**
 * Splitting a file into its parts, and the YAML of the frontmatter. Frontmatter is written by a YAML
 * writer and never by concatenation; this module is that writer. It keeps what it did not change:
 * fields, their order, their comments, their quote styles, and fields this version does not know.
 */

export interface SplitFile {
  /** The file as the rest of the code reads it: no BOM, LF line endings. */
  text: string;
  hadBom: boolean;
  hadCrlf: boolean;
  /** The YAML between the fences, or null when the file does not open with a fence. */
  front: string | null;
  /** 1-based file line of the first line of `front`. */
  frontStartLine: number;
  /** What follows the closing fence. When there is no frontmatter, the whole text. */
  body: string;
  /** 1-based file line where `body` starts. */
  bodyStartLine: number;
  /** The file opened a fence and never closed it. */
  unclosed: boolean;
}

/** Normalise the bytes' text: drop a BOM, turn CRLF (and a stray CR) into LF. */
function normalise(raw: string): { text: string; hadBom: boolean; hadCrlf: boolean } {
  const hadBom = raw.charCodeAt(0) === 0xfeff;
  const noBom = hadBom ? raw.slice(1) : raw;
  const hadCrlf = noBom.includes("\r\n");
  return { text: noBom.replace(/\r\n?/g, "\n"), hadBom, hadCrlf };
}

export function splitFile(raw: string): SplitFile {
  const { text, hadBom, hadCrlf } = normalise(raw);
  const base = { text, hadBom, hadCrlf };
  const lines = text.split("\n");
  if (lines[0]?.trimEnd() !== "---") {
    return { ...base, front: null, frontStartLine: 0, body: text, bodyStartLine: 1, unclosed: false };
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trimEnd() === "---") {
      return {
        ...base,
        front: lines.slice(1, i).join("\n"),
        frontStartLine: 2,
        body: lines.slice(i + 1).join("\n"),
        bodyStartLine: i + 2,
        unclosed: false,
      };
    }
  }
  return { ...base, front: null, frontStartLine: 2, body: "", bodyStartLine: lines.length + 1, unclosed: true };
}

/** Reading failed: the YAML does not parse, or is not a mapping. */
export interface FrontmatterError {
  message: string;
}

export class Frontmatter {
  readonly doc: Document;

  private constructor(doc: Document) {
    this.doc = doc;
  }

  static empty(): Frontmatter {
    return new Frontmatter(new Document({}));
  }

  /** Parse YAML 1.2. Never throws. Duplicate keys and any syntax error are errors; an empty one has no fields. */
  static parse(src: string): Frontmatter | FrontmatterError {
    const doc = parseDocument(src, { version: "1.2", uniqueKeys: true, prettyErrors: false });
    if (doc.errors.length > 0) return { message: doc.errors[0]!.message.split("\n")[0]! };
    if (doc.contents !== null && !isMap(doc.contents)) return { message: "the frontmatter is not a mapping of fields" };
    return new Frontmatter(doc);
  }

  keys(): string[] {
    return isMap(this.doc.contents) ? this.doc.contents.items.map((p) => String((p.key as Scalar).value ?? p.key)) : [];
  }

  has(key: string): boolean {
    return this.doc.has(key);
  }

  /** The JS value. A bare number or boolean the user typed comes back as it was typed, as a string. */
  getString(key: string): string | undefined {
    const node = this.doc.get(key, true);
    if (node === undefined || node === null) return undefined;
    if (isScalar(node)) {
      if (node.value === null || node.value === undefined) return undefined;
      if (typeof node.value === "string") return node.value;
      return node.source ?? String(node.value);
    }
    return undefined;
  }

  /** The kind of value at `key`, for reporting a field of the wrong shape. */
  kind(key: string): "missing" | "null" | "string" | "list" | "other" {
    const node = this.doc.get(key, true);
    if (node === undefined) return "missing";
    if (isScalar(node)) return node.value === null ? "null" : "string";
    if (node instanceof YAMLSeq) return "list";
    return "other";
  }

  /** A list of strings; a single string counts as a list of one. Items that are not scalars are dropped. */
  getList(key: string): string[] | undefined {
    const node = this.doc.get(key, true);
    if (node === undefined || node === null) return undefined;
    if (isScalar(node)) {
      const s = this.getString(key);
      return s === undefined ? undefined : [s];
    }
    if (node instanceof YAMLSeq) {
      return node.items.flatMap((it) =>
        isScalar(it) && it.value !== null
          ? [typeof it.value === "string" ? it.value : (it.source ?? String(it.value))]
          : [],
      );
    }
    return undefined;
  }

  /** Set a string or a list of strings, keeping the field's place and the other fields untouched. */
  set(key: string, value: string | string[], opts: { raw?: boolean; quoted?: boolean } = {}): void {
    this.doc.set(key, nodeFor(this.doc, value, opts.raw, opts.quoted));
  }

  /** Set a whole number, written as a YAML integer and not as a quoted string. */
  setInteger(key: string, value: number): void {
    this.doc.set(key, new Scalar(value));
  }

  /** Set a boolean, written as YAML `true` or `false` and not as a quoted string. */
  setBoolean(key: string, value: boolean): void {
    this.doc.set(key, new Scalar(value));
  }

  delete(key: string): void {
    this.doc.delete(key);
  }

  /** The YAML text between the fences, ending in a newline, or "" when there are no fields. */
  toString(): string {
    if (this.keys().length === 0) return "";
    const out = this.doc.toString({ lineWidth: 0, flowCollectionPadding: false });
    return out.endsWith("\n") ? out : out + "\n";
  }
}

/** Plain or double-quoted, whichever keeps the string a string for every YAML reader; `quoted` forces double quotes. */
function nodeFor(doc: Document, value: string | string[], raw = false, quoted = false): Scalar | YAMLSeq {
  if (Array.isArray(value)) {
    const seq = doc.createNode(value.map((v) => scalar(v, false))) as YAMLSeq;
    seq.flow = true;
    return seq;
  }
  return scalar(value, raw, quoted);
}

function scalar(value: string, raw: boolean, quoted = false): Scalar {
  const s = new Scalar(value);
  if (quoted || (!raw && needsQuotes(value))) s.type = "QUOTE_DOUBLE";
  return s;
}

const WORDS = /^(?:y|yes|n|no|on|off|true|false|null|~)$/i;
const NUMBER = /^[-+]?(?:\d[\d_,]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$|^[-+]?0[xob][\da-f_]+$|^[-+]?\.(?:inf|nan)$/i;
const TIME_OR_DATE = /^\d{1,4}(?:[-:/]\d{1,2}){1,2}|^\d+(?::\d{2}){1,2}(?:\.\d*)?$/;

/**
 * True for a string a YAML 1.1 reader would read as something else, `yes`, `no`, `on`, `off`, `null`,
 * numbers, times and dates, or that is empty or edged with space. Strings that merely need quoting to
 * be valid YAML (`a: b`, `- x`, `#c`) are left to the writer, which quotes them itself.
 */
function needsQuotes(s: string): boolean {
  return s === "" || s !== s.trim() || WORDS.test(s) || NUMBER.test(s) || TIME_OR_DATE.test(s);
}
