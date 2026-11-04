import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SemanticDeps } from "../src/core/semantic/meaning.ts";
import { loadEmbedder } from "../src/core/semantic/embedder.ts";
import type { Pins } from "../src/core/semantic/pins.ts";

/** The platform the stand-in engine is built for. */
export const TEST_PLATFORM = "test-x64";

/**
 * A stand-in for `transformers.js`: no model, one dimension per concept, the words of each concept in both languages,
 * so that a Spanish text and an English one on the same subject point the same way. It records every import, so a
 * test can tell whether a process loaded the engine.
 */
export const FAKE_ENGINE = `
const CONCEPTS = [["migra"], ["wifi", "password", "contrase"], ["party", "fiesta", "weekend"], ["abre", "horario", "nueve", "opens", "hours"]];
globalThis.__kiokuEngines = [...(globalThis.__kiokuEngines ?? []), import.meta.url];
export const env = {};
export async function pipeline(task, model, options) {
  if (task !== "feature-extraction") throw new Error("unexpected task " + task);
  const run = async (texts, o) => {
    globalThis.__kiokuCalls = [...(globalThis.__kiokuCalls ?? []), { texts, pooling: o?.pooling }];
    const d = CONCEPTS.length + 1;
    const data = new Float32Array(texts.length * d);
    texts.forEach((t, i) => {
      const w = t.toLowerCase();
      CONCEPTS.forEach((c, j) => { data[i * d + j] = c.filter((x) => w.includes(x)).length; });
      data[i * d + d - 1] = 0.3;
      let n = 0;
      for (let k = 0; k < d; k++) n += data[i * d + k] ** 2;
      for (let k = 0; k < d; k++) data[i * d + k] /= Math.sqrt(n);
    });
    return { dims: [texts.length, d], data };
  };
  return run;
}
`;

/** What the stand-in engine was last asked to embed: the texts as given and the pooling. */
export const lastEmbedCall = (): { texts: string[]; pooling: string } | undefined =>
  ((globalThis as { __kiokuCalls?: never[] }).__kiokuCalls ?? []).at(-1);

/** Whether the engine installed under this home was imported by this process. */
export const engineLoaded = (home: string): boolean =>
  ((globalThis as { __kiokuEngines?: string[] }).__kiokuEngines ?? []).some(
    (u) => u.includes(encodeURI(home)) || u.includes(home),
  );

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function tgz(dir: string, name: string, files: Record<string, string>): string {
  const src = join(dir, "src", name);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(src, "package", rel)), { recursive: true });
    writeFileSync(join(src, "package", rel), text);
  }
  const out = join(dir, `${name}.tgz`);
  execFileSync("tar", ["-czf", out, "-C", src, "package"]);
  return out;
}

export interface FakeSemantic {
  deps: SemanticDeps;
  pins: Pins;
  /** The URLs downloaded, in order. */
  calls: string[];
  /** Serve other bytes for a URL from now on. */
  tamper: (url: string) => void;
  modelUrl: (path: string) => string;
}

/** Pins, tarballs and model files that stand in for the real ones, served from disk; nothing touches the network. */
export function fakeSemantic(dir: string, o: { modelName?: string } = {}): FakeSemantic {
  mkdirSync(dir, { recursive: true });
  const served = new Map<string, string>();
  const integrity = (file: string) => `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`;
  const pkg = (name: string, files: Record<string, string>, keep: string[]) => {
    const file = tgz(dir, name.replace("/", "+"), files);
    const url = `https://packages.test/${name}.tgz`;
    served.set(url, file);
    return { name, version: "1.0.0", url, integrity: integrity(file), size: readFileSync(file).length, keep };
  };
  const binding = "a native binding\n";
  const library = "a native library\n".repeat(100);
  const packages = [
    pkg(
      "@huggingface/transformers",
      {
        "package.json": '{"name":"@huggingface/transformers","type":"module"}\n',
        "dist/transformers.node.mjs": FAKE_ENGINE,
        "dist/transformers.web.js": "web\n",
      },
      ["package.json", "dist/transformers.node.mjs"],
    ),
    pkg(
      "onnxruntime-common",
      { "package.json": '{"name":"onnxruntime-common"}\n', "dist/index.js": "module.exports = {};\n" },
      ["package.json", "dist/"],
    ),
    pkg(
      "onnxruntime-node",
      {
        "package.json": '{"name":"onnxruntime-node"}\n',
        "dist/index.js": "module.exports = {};\n",
        "bin/napi-v6/test/x64/onnxruntime_binding.node": binding,
        "bin/napi-v6/test/x64/libonnxruntime.so.1": library,
        "bin/napi-v6/other/arm64/onnxruntime_binding.node": "another platform\n",
      },
      ["package.json", "dist/"],
    ),
  ];
  const modelFiles: Record<string, string> = {
    "config.json": '{"model_type":"bert"}\n',
    "tokenizer.json": "{}\n",
    "onnx/model_quantized.onnx": "weights ".repeat(1000),
  };
  const modelUrl = (path: string) => `https://models.test/${o.modelName ?? "test/model"}/${path}`;
  for (const [path, text] of Object.entries(modelFiles)) {
    const file = join(dir, "model", o.modelName ?? "test", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    served.set(modelUrl(path), file);
  }
  const pins: Pins = {
    engine: {
      version: "test engine 1",
      packages,
      native: {
        [TEST_PLATFORM]: [
          {
            path: "bin/napi-v6/test/x64/onnxruntime_binding.node",
            size: binding.length,
            sha256: sha256(Buffer.from(binding)),
          },
          {
            path: "bin/napi-v6/test/x64/libonnxruntime.so.1",
            size: library.length,
            sha256: sha256(Buffer.from(library)),
          },
        ],
      },
    },
    model: {
      id: "test/model",
      revision: "1",
      name: o.modelName ?? "test/model@1 q8",
      dtype: "q8",
      prefix: { query: "query: ", passage: "passage: " },
      pooling: "mean",
      url: modelUrl,
      files: Object.entries(modelFiles).map(([path, text]) => ({
        path,
        size: Buffer.byteLength(text),
        sha256: sha256(Buffer.from(text)),
      })),
    },
  };
  const calls: string[] = [];
  const tampered = new Set<string>();
  const deps: SemanticDeps = {
    pins,
    platform: TEST_PLATFORM,
    loadEmbedder,
    download: async (url) => {
      calls.push(url);
      const file = served.get(url);
      if (file === undefined) throw new Error(`${url} answered 404`);
      if (tampered.has(url))
        return (async function* () {
          yield Buffer.from("not what was pinned");
        })();
      return createReadStream(file);
    },
  };
  return { deps, pins, calls, tamper: (url) => tampered.add(url), modelUrl };
}
