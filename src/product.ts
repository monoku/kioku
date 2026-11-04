import pkg from "../package.json" with { type: "json" };

/**
 * Where the product lives, named once, in `package.json` (§6.1): the repository whose releases the installer and
 * `kioku update` fetch. The bundle carries these values; moving the product is one edit there (and one in
 * `install.sh`, which runs before the tool).
 */

/** What Kioku is, in the brand's words: `package.json`'s `description` in lower case, `memory for coding agents`. */
export const TAGLINE: string = pkg.description.charAt(0).toLowerCase() + pkg.description.slice(1);
/** `host/owner/repo` of the product repository, from `repository.url`. */
export const PRODUCT_REPO: string = pkg.repository.url.replace(/^[a-z+]+:\/\//i, "").replace(/\.git$/, "");
/** `owner/repo` on GitHub, for the raw URL of the installer. */
const GITHUB_REPO: string = PRODUCT_REPO.replace(/^github\.com\//, "");
/** The name `plugins/claude-code/.claude-plugin/marketplace.json` gives the marketplace the plugin ships in, beside the tool (§6.2). */
export const MARKETPLACE_NAME = "kioku";
/** The installer, on the repository's main branch (§6.3). */
export const INSTALL_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh`;
/** The one command that installs Kioku (§6.3). */
export const INSTALL_COMMAND = `curl -fsSL ${INSTALL_URL} | sh`;
/** What changed in each version. */
export const CHANGELOG_URL = `https://${PRODUCT_REPO}/blob/main/CHANGELOG.md`;
/** The command-line reference, on the repository's main branch: where `help` sends for more (§6.1). */
export const CLI_REFERENCE_URL = `https://${PRODUCT_REPO}/blob/main/docs/reference/cli.md`;
