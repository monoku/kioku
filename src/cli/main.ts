import { fileURLToPath } from "node:url";
import { defaultContext, run } from "./run.ts";

// Only the bundle is copied by the launcher; run from source, there is nothing to copy.
const bundle = import.meta.url.endsWith(".mjs") ? fileURLToPath(import.meta.url) : undefined;

// A reader that closes early (`kioku … | head`) is the shell's way of saying enough: stop quietly, not with a trace.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

const code = await run(
  process.argv.slice(2),
  {
    stdout: (t) => process.stdout.write(t),
    isTty: Boolean(process.stdout.isTTY),
    columns: process.stdout.columns,
    stderrTty: Boolean(process.stderr.isTTY),
  },
  defaultContext(bundle),
);
process.exitCode = code;
// The host waits for a hook's process to end: once it has answered, work it gave up on (a recall past its budget, §4.7)
// must not keep it, so it ends as soon as what it wrote is flushed. What a hook starts in the background is detached.
if (process.argv[2] === "hook") process.stdout.write("", () => process.exit(code));
