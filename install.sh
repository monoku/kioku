#!/bin/sh
# Installs Kioku (§6.3): the latest release, the bundle and its plugin, under ~/.local/share/kioku, one folder per
# version, `current` pointing at the active one, and the launcher ~/.local/bin/kioku; then, in a terminal, `kioku setup`,
# so that `kioku` is ready to use. Arguments go to `setup` (`sh -s -- --no-model`, say).
#   curl -fsSL https://raw.githubusercontent.com/monoku/kioku/main/install.sh | sh
# A person may move the two folders, KIOKU_INSTALL_DIR and KIOKU_BIN_DIR. The tests read four more, which are not
# documented and not for people: KIOKU_REPO (owner/repo), KIOKU_VERSION (one release instead of the latest),
# KIOKU_BASE_URL (where the assets are, instead of GitHub) and KIOKU_NO_SETUP (install only).
set -eu

REPO="${KIOKU_REPO:-monoku/kioku}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_DIR="${KIOKU_INSTALL_DIR:-$DATA/kioku}"
BIN_DIR="${KIOKU_BIN_DIR:-$HOME/.local/bin}"
# The tool writes the launcher with the same text; a trailing slash would make the two differ.
INSTALL_DIR="${INSTALL_DIR%/}"
BIN_DIR="${BIN_DIR%/}"
MIN_NODE=24

say() { printf '%s\n' "$*"; }
die() { printf 'kioku install: %s\n' "$*" >&2; exit 1; }

# --- where the release lives: the latest, or a version
if [ -n "${KIOKU_BASE_URL:-}" ]; then
  BASE="$KIOKU_BASE_URL"
elif [ -n "${KIOKU_VERSION:-}" ]; then
  BASE="https://github.com/$REPO/releases/download/v$KIOKU_VERSION"
else
  BASE="https://github.com/$REPO/releases/latest/download"
fi

# --- prerequisites
command -v curl >/dev/null 2>&1 || die "curl is needed"
command -v tar >/dev/null 2>&1 || die "tar is needed to unpack the plugin"
command -v node >/dev/null 2>&1 || die "Node $MIN_NODE or later is needed, and node is not on your PATH (https://nodejs.org)"
NODE_MAJOR=$(node --version | sed 's/^v//; s/\..*//')
case "$NODE_MAJOR" in ''|*[!0-9]*) die "cannot read node's version";; esac
[ "$NODE_MAJOR" -ge "$MIN_NODE" ] || die "Node $MIN_NODE or later is needed; this is Node $NODE_MAJOR"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "sha256sum or shasum is needed to check the download"; fi
}

fetch() {
  # curl's own words, for the message: a name that does not resolve, a 404 and a certificate are not the same fix.
  WHY=$(curl -fsSL "$BASE/$1" -o "$2" 2>&1) && return 0
  WHY=$(printf '%s' "$WHY" | sed -n '$p' | sed 's/^curl: ([0-9]*) //')
  die "could not download $BASE/$1: ${WHY:-no reason given}"
}

# --- download and check, in a scratch folder
TMP=$(mktemp -d "${TMPDIR:-/tmp}/kioku-install.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM
say "Downloading Kioku from $BASE"
fetch kioku.mjs "$TMP/kioku.mjs"
fetch kioku.mjs.sha256 "$TMP/kioku.mjs.sha256"
# The plugin travels beside the bundle (§6.2): each asset is checked against its own checksum.
fetch kioku-plugin.tar.gz "$TMP/kioku-plugin.tar.gz"
fetch kioku-plugin.tar.gz.sha256 "$TMP/kioku-plugin.tar.gz.sha256"
for ASSET in kioku.mjs kioku-plugin.tar.gz; do
  WANT=$(cut -d' ' -f1 "$TMP/$ASSET.sha256")
  GOT=$(sha256 "$TMP/$ASSET")
  [ "$WANT" = "$GOT" ] || die "the download of $ASSET does not match its checksum; nothing was installed"
done
# --- its version names its folder
VERSION=$(node "$TMP/kioku.mjs" --version --json 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
[ -n "$VERSION" ] || die "the download is not a Kioku bundle"

# --- install: versions/<v>/kioku.mjs and its plugin, current -> that version, the launcher in BIN_DIR. The plugin is
# in place before current moves, so current/plugin, which Claude Code reads, is always one (§6.2).
FRESH=""
[ -d "$INSTALL_DIR/versions/$VERSION" ] || FRESH=1
mkdir -p "$INSTALL_DIR/versions/$VERSION" "$BIN_DIR"
cp "$TMP/kioku.mjs" "$INSTALL_DIR/versions/$VERSION/kioku.mjs"
undo() {
  [ -n "$FRESH" ] && rm -rf "$INSTALL_DIR/versions/$VERSION"
  die "$1; nothing was installed"
}
# The bundle downloaded unpacks its own plugin, checked above, so how a release lays it out is known only to that
# release's tool (§6.3, §6.4). One from before that hand-over does not know --prepare: its one layout is put in place here.
if ! node "$INSTALL_DIR/versions/$VERSION/kioku.mjs" update --prepare --archive "$TMP/kioku-plugin.tar.gz" --json \
  >"$TMP/prepared" 2>&1; then
  if grep -q "unknown flag --prepare" "$TMP/prepared"; then
    mkdir "$TMP/plugin"
    tar -xzf "$TMP/kioku-plugin.tar.gz" -C "$TMP/plugin" || undo "the plugin's archive could not be unpacked"
    [ -f "$TMP/plugin/.claude-plugin/marketplace.json" ] || undo "the plugin's archive holds no marketplace"
    rm -rf "$INSTALL_DIR/versions/$VERSION/plugin"
    mv "$TMP/plugin" "$INSTALL_DIR/versions/$VERSION/plugin"
  else
    undo "the plugin could not be put in place ($(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' "$TMP/prepared" | tail -n 1))"
  fi
fi
ln -sfn "versions/$VERSION" "$INSTALL_DIR/current"
LAUNCHER="$BIN_DIR/kioku"
cat > "$TMP/launcher" <<LAUNCH
#!/bin/sh
# Written by Kioku. Runs the active version, or the build KIOKU_BIN names when it is set.
[ -n "\${KIOKU_BIN:-}" ] && exec "\$KIOKU_BIN" "\$@"
exec node "$INSTALL_DIR/current/kioku.mjs" "\$@"
LAUNCH
chmod 755 "$TMP/launcher"
mv -f "$TMP/launcher" "$LAUNCHER"
say "Installed Kioku $VERSION: $LAUNCHER"

# --- `kioku setup`, in a terminal only: the configuration and the profile are the person's (§6.3). `curl | sh` gives
# this script the download on its input, so setup reads the person's terminal, /dev/tty, instead. Never a brain.
case ":${PATH:-}:" in *":$BIN_DIR:"*) NEXT="kioku setup" ;; *) NEXT="$LAUNCHER setup" ;; esac
if [ -z "${KIOKU_NO_SETUP:-}" ] && [ -t 1 ] && (: </dev/tty) 2>/dev/null; then
  say ""
  "$LAUNCHER" setup "$@" </dev/tty || say "kioku setup did not finish; Kioku is installed. To finish, in a terminal: $NEXT"
else
  say "Next, in a terminal: $NEXT"
fi
