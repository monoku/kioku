import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The real git, found before the shim stands in front of it. */
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

/**
 * Every git process `body` spawns, as its arguments: a `git` on the `PATH` that writes them down and runs the real
 * one. When `race` names a clone, that clone pushes right before the first `push` seen, so that push is beaten.
 */
export async function gitCalls(dir: string, body: () => Promise<unknown>, race?: string): Promise<string[]> {
  const bin = join(dir, "shim");
  const log = join(dir, "git-calls.log");
  const trigger = join(dir, "race");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      // Calls apart by a record separator and arguments by a unit separator: an argument may hold spaces or lines.
      `printf '%s\\037' "$@" >> "${log}"; printf '\\036' >> "${log}"`,
      `if [ -e "${trigger}" ]; then case " $* " in *" push "*) other=$(cat "${trigger}"); rm -f "${trigger}"; "${REAL_GIT}" -C "$other" push -q origin HEAD:main >/dev/null 2>&1 ;; esac; fi`,
      `exec "${REAL_GIT}" "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "git"), 0o755);
  if (race !== undefined) writeFileSync(trigger, race);
  rmSync(log, { force: true });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await body();
  } finally {
    process.env.PATH = path;
  }
  return existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\u001e")
        .filter((l) => l !== "")
    : [];
}
