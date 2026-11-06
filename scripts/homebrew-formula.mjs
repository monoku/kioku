#!/usr/bin/env node
// The Homebrew formula of a release (§6.3), printed: the release's bundle and the plugin's archive, each with the
// checksum the release published, Homebrew's Node, the plugin under the formula's `opt` folder, which does not move
// between versions (§6.2), the completion of `kioku completion <shell>`, and the next steps, the installer's three.
// The release workflow writes it into the tap, `<owner>/homebrew-kioku`, at each release (§6.4).
//   node scripts/homebrew-formula.mjs --bundle-sha <sha256> --plugin-sha <sha256> [--version <v>] [--base <url>]
// `--version` is package.json's when absent; `--base`, where the assets are instead of the release, is for trying the
// formula on files of this machine.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const repo = pkg.repository.url.replace(/^[a-z+]+:\/\//i, "").replace(/\.git$/, "");

/**
 * The formula for `version`, its assets at `base`, with their checksums.
 * @param {{ version: string; bundleSha: string; pluginSha: string; base?: string | undefined }} o
 * @returns {string}
 */
export function formula({ version, bundleSha, pluginSha, base }) {
  const sha = /^[0-9a-f]{64}$/;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} is not a release version, such as 1.2.0`);
  if (!sha.test(bundleSha) || !sha.test(pluginSha)) throw new Error("each checksum is 64 hexadecimal digits");
  const at = (base ?? `https://${repo}/releases/download/v${version}`).replace(/\/$/, "");
  return `# Written by ${repo}'s release (scripts/homebrew-formula.mjs); a change made here is lost at the next one.
class Kioku < Formula
  desc "${pkg.description}"
  homepage "https://${repo}"
  url "${at}/kioku.mjs"
  version "${version}"
  sha256 "${bundleSha}"
  license "${pkg.license}"

  depends_on "node"

  resource "plugin" do
    url "${at}/kioku-plugin.tar.gz"
    sha256 "${pluginSha}"
  end

  def install
    libexec.install "kioku.mjs"
    # The plugin's marketplace is a hidden folder, which Dir["*"] leaves out.
    resource("plugin").stage { (libexec/"plugin").install Dir["*"], ".claude-plugin" }
    (bin/"kioku").write <<~SH
      #!/bin/sh
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/kioku.mjs" "$@"
    SH
    chmod 0755, bin/"kioku"
    generate_completions_from_executable(bin/"kioku", "completion")
  end

  def caveats
    <<~EOS
      To finish, in a terminal:
        kioku setup
        kioku brain create <you>/memory
        kioku plugin claude-code install
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kioku --version")
    assert_path_exists libexec/"plugin/.claude-plugin/marketplace.json"
  end
end
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      "bundle-sha": { type: "string" },
      "plugin-sha": { type: "string" },
      base: { type: "string" },
    },
  });
  try {
    process.stdout.write(
      formula({
        version: values.version ?? pkg.version,
        bundleSha: values["bundle-sha"] ?? "",
        pluginSha: values["plugin-sha"] ?? "",
        base: values.base,
      }),
    );
  } catch (e) {
    process.stderr.write(`homebrew-formula: ${e.message}\n`);
    process.exit(1);
  }
}
