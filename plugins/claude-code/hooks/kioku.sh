#!/usr/bin/env bash
# What the plugin's hooks run: the kioku launcher, found by KIOKU_BIN, then the PATH,
# then the installer's folder, handed the plugin's version (§6.2). A hook never fails a session:
# with no kioku, the session start says so to the person, and the other hooks say nothing.
# Usage: kioku.sh hook session-start|user-prompt-submit|pre-tool-use|post-tool-use

# Bash's own words wherever one will do: every prompt and tool call waits for this script.

# Every file the agent reads or changes comes through here (§4.7): where no page says which files it is about, the
# index has no marker beside it, and this ends before anything is started.
if [[ "$1 $2" == "hook pre-tool-path" && ! -e "${KIOKU_HOME:-$HOME}/.kioku/index.sqlite.applies" ]]; then
    exit 0
fi
# The same for a session's handoff (§4.8): a machine that holds none starts nothing for it.
if [[ "$1 $2" == "hook session-start-handoff" && ! -d "${KIOKU_HOME:-$HOME}/.kioku/handoffs" ]]; then
    exit 0
fi

if [[ -n "$KIOKU_BIN" ]]; then
    bin="$KIOKU_BIN"
elif launcher=$(command -v kioku); then
    bin="$launcher"
elif [[ -x "${KIOKU_BIN_DIR:-$HOME/.local/bin}/kioku" ]]; then
    bin="${KIOKU_BIN_DIR:-$HOME/.local/bin}/kioku"
else
    if [[ "$1 $2" == "hook session-start" ]]; then
        echo '{"systemMessage":"⬢ kioku.md · ⚠ not installed on this machine, so the plugin does nothing · run the installer from the Kioku repository, or set KIOKU_BIN to the launcher"}'
    fi
    exit 0
fi

# The version the plugin's manifest declares, handed to the tool, which says when the two differ and runs all the
# same (§6.2). Read here, without a subshell.
plugin_version() {
    local script="${BASH_SOURCE[0]}" hooks="." line pattern='^[[:space:]]*"version":[[:space:]]*"([^"]*)"'
    [[ "$script" == */* ]] && hooks="${script%/*}"
    [[ -r "$hooks/../.claude-plugin/plugin.json" ]] || return
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ $pattern ]]; then
            export KIOKU_PLUGIN_VERSION="${BASH_REMATCH[1]}"
            return
        fi
    done <"$hooks/../.claude-plugin/plugin.json"
}

plugin_version
exec "$bin" "$@"
