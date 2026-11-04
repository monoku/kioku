import { fileURLToPath } from "node:url";
import { defaultContext, run } from "./run.ts";

// Only the bundle is copied by the launcher; run from source, there is nothing to copy.
const bundle = import.meta.url.endsWith(".mjs") ? fileURLToPath(import.meta.url) : undefined;

// A reader that closes early (`kioku … | head`) is the shell's way of saying enough: stop quietly, not with a trace.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

process.exitCode = await run(
  process.argv.slice(2),
  {
    stdout: (t) => process.stdout.write(t),
    isTty: Boolean(process.stdout.isTTY),
    columns: process.stdout.columns,
    stderrTty: Boolean(process.stderr.isTTY),
  },
  defaultContext(bundle),
);
