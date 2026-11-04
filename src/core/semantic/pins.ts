/**
 * What the meaning half of search downloads (§4.3), pinned: exact versions, exact URLs, checksums.
 * Data only, so that the session hook and `doctor` can read it without loading anything that downloads or runs a
 * model. There is one model; a new pin of it, another name, rebuilds every vector at the next `sync`. Changing
 * `ENGINE.version` fetches the engine again.
 */

/** An npm tarball: its URL, its registry integrity (`sha512-…`), and which of its files are kept. */
export interface PackagePin {
  name: string;
  version: string;
  url: string;
  integrity: string;
  size: number;
  /** Paths inside the tarball (below `package/`) to keep; a trailing `/` keeps a folder. The platform's own files are added. */
  keep: string[];
}

/** A file whose content is pinned: its path, size and SHA-256. */
export interface FilePin {
  path: string;
  size: number;
  sha256: string;
}

/** Where the engine's native library and its Node binding sit inside its package, per `platform-arch`. */
export type Platform = "darwin-arm64" | "linux-x64" | "linux-arm64" | "win32-x64";

const NATIVE = "bin/napi-v6";

export const ENGINE = {
  /** `onnxruntime-node` driven through `transformers.js`. */
  version: "onnxruntime-node 1.30.0, transformers.js 4.3.1",
  packages: [
    {
      name: "@huggingface/transformers",
      version: "4.3.1",
      size: 2_268_123,
      url: "https://registry.npmjs.org/@huggingface/transformers/-/transformers-4.3.1.tgz",
      integrity: "sha512-5+voSeUCFK6PCKlY15dPhNOKq3/zOTxDN7oC+Wy9dFb1QZ0TSQomZRRy7URRK8YRuUoE9fGMQTTPC5d/pWBJhA==",
      keep: ["package.json", "dist/transformers.node.mjs"],
    },
    {
      name: "onnxruntime-common",
      version: "1.30.0",
      size: 66_795,
      url: "https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-1.30.0.tgz",
      integrity: "sha512-7fdVWjAID1dVhH/G8qK3APARunV4VkBFoCQAP7qp4Wkab0mrorvmc+sqiT+mKXOzDqdjN5j+/Z9nb4gzNPWcyA==",
      keep: ["package.json", "dist/"],
    },
    {
      name: "onnxruntime-node",
      version: "1.30.0",
      size: 113_507_888,
      url: "https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.30.0.tgz",
      integrity: "sha512-twhs1C2C/BFkz1yc5OY0KIU2GUq6DURO7hD4bx5Q2Qy3nAMJwRXW8xU3NVczE29VA9lolLOYepoD8fjTGOfIqw==",
      keep: ["package.json", "dist/"],
    },
  ] satisfies PackagePin[],
  /** The native files of `onnxruntime-node` for each platform, below its package folder. */
  native: {
    "darwin-arm64": [
      {
        path: `${NATIVE}/darwin/arm64/onnxruntime_binding.node`,
        size: 266_840,
        sha256: "a3f993357759b06ae2411f70af60f5e041d04521ea7f0d12cb7546e411a527dd",
      },
      {
        path: `${NATIVE}/darwin/arm64/libonnxruntime.1.dylib`,
        size: 44_589_928,
        sha256: "685d2be5dba1309c89d3a5324b7fd06a5c42f1a61bfea32d14c4cc28d072121d",
      },
    ],
    "linux-x64": [
      {
        path: `${NATIVE}/linux/x64/onnxruntime_binding.node`,
        size: 389_488,
        sha256: "ccdc60b981d93a490cf9513d3f583547252b6e285b72988a96a494f2f006c7b8",
      },
      {
        path: `${NATIVE}/linux/x64/libonnxruntime.so.1`,
        size: 45_828_512,
        sha256: "ffb75a925ba05e47b235bb66e3e3911714a80b328a9c9425539feb204aa32a23",
      },
    ],
    "linux-arm64": [
      {
        path: `${NATIVE}/linux/arm64/onnxruntime_binding.node`,
        size: 394_648,
        sha256: "afec78dc11d38dc81605b068cefe1fc73ffe77ca240c15468aa40786150beac8",
      },
      {
        path: `${NATIVE}/linux/arm64/libonnxruntime.so.1`,
        size: 25_135_496,
        sha256: "1f549d46250b005580b597f4164984aaf75b3bcb9f3aeb07c7f8a8fe60b23c76",
      },
    ],
    "win32-x64": [
      {
        path: `${NATIVE}/win32/x64/onnxruntime_binding.node`,
        size: 298_848,
        sha256: "ddd428464069b84414d34ec1796c7c2a69c33a976e4b0390692629e394f92fa1",
      },
      {
        path: `${NATIVE}/win32/x64/onnxruntime.dll`,
        size: 28_754_232,
        sha256: "508c362f5673483dd3a086379c392795b2e42d10d5e6f3f90ebd7ac21c97af67",
      },
      {
        path: `${NATIVE}/win32/x64/DirectML.dll`,
        size: 18_527_584,
        sha256: "234e8898778cdec88d3cb0539508273494082812c968699f3de665a018971625",
      },
      {
        path: `${NATIVE}/win32/x64/dxcompiler.dll`,
        size: 17_986_360,
        sha256: "593d42df78c7f9cbd97c1374af107cfe20985759f98b77afc1448fe41ee3cc76",
      },
      {
        path: `${NATIVE}/win32/x64/dxil.dll`,
        size: 1_508_664,
        sha256: "cf9a3981263f8ec30c9905d136eeaf4b4573209c602198671b958ec86905dea8",
      },
    ],
  } satisfies Record<Platform, FilePin[]>,
};

/** How a model must be used to embed well, as its authors trained it. */
export interface ModelUsage {
  /** What a question and a passage are prefixed with before embedding. */
  prefix: { query: string; passage: string };
  /** How the token vectors become one: their mean, or the first token's. */
  pooling: "mean" | "cls";
}

/** A model, as `transformers.js` loads it: its repository and revision, its int8 build, how to use it, its files. */
export interface ModelPin extends ModelUsage {
  id: string;
  revision: string;
  /** What a vector is stamped with; a vector of another name is rebuilt. */
  name: string;
  /** The int8 build `transformers.js` loads as `onnx/model_quantized.onnx`. */
  dtype: string;
  url: (path: string) => string;
  files: FilePin[];
}

function pinned(repo: string, revision: string, usage: ModelUsage, files: FilePin[]): ModelPin {
  return {
    id: repo,
    revision,
    name: `${repo}@${revision.slice(0, 7)} q8`,
    dtype: "q8",
    ...usage,
    url: (path) => `https://huggingface.co/${repo}/resolve/${revision}/${path}`,
    files,
  };
}

const E5: ModelUsage = { prefix: { query: "query: ", passage: "passage: " }, pooling: "mean" };

/** The model search runs (§4.3): multilingual, since the brains mix languages; about 135 MB, a search process near 770 MB. */
export const MODEL: ModelPin = pinned("Xenova/multilingual-e5-small", "761b726dd34fb83930e26aab4e9ac3899aa1fa78", E5, [
  { path: "config.json", size: 658, sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1" },
  {
    path: "tokenizer.json",
    size: 17_082_730,
    sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
  },
  {
    path: "tokenizer_config.json",
    size: 443,
    sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
  },
  {
    path: "special_tokens_map.json",
    size: 167,
    sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
  },
  {
    path: "onnx/model_quantized.onnx",
    size: 118_308_185,
    sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
  },
]);

/** The pins as one value, so a test can stand in its own. */
export interface Pins {
  engine: { version: string; packages: PackagePin[]; native: Record<string, FilePin[]> };
  model: ModelPin;
}

/** The engine and the model. */
export const PINS: Pins = { engine: ENGINE, model: MODEL };

/** This machine's `platform-arch`. */
export const currentPlatform = (): string => `${process.platform}-${process.arch}`;

/** Roughly what the first fetch downloads on a platform, in MB, for the person to read. */
export function downloadMB(pins: Pins = PINS): number {
  const bytes = pins.engine.packages.reduce((n, p) => n + p.size, 0) + pins.model.files.reduce((n, f) => n + f.size, 0);
  return Math.round(bytes / 10_000_000) * 10;
}
