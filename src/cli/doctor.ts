import { realDoctorEnv, runDoctor } from "../core/doctor.ts";
import { userError } from "../core/errors.ts";
import { allHarnesses } from "../harness/index.ts";
import { installDirs, installOrigin, pluginFolder } from "../core/setup/install.ts";
import { CLI_CONTRACT, VERSION } from "../version.ts";
import { toolVersion } from "./plugin.ts";
import { PLAIN, paint } from "./render.ts";
import type { Handler } from "./run.ts";
import { personHome } from "./home.ts";

/** `kioku doctor` (§6.1): non-zero only when something required is missing. */
export const runDoctorVerb: Handler = (args, ctx) => {
  if (args.length > 0) throw userError("doctor takes no arguments", "usage");
  const report = runDoctor({
    ...realDoctorEnv(ctx.home, ctx.env.PATH, ctx.cwd, allHarnesses(personHome(ctx), ctx.env), ctx.env, ctx.hostHome),
    tool: toolVersion(ctx),
    ...besideTool(ctx),
  });
  const ui = ctx.ui ?? PLAIN;
  const p = paint(ui);
  const mark = { ok: p.green, warn: p.yellow, missing: p.red } as const;
  const width = Math.max(...report.checks.map((c) => c.name.length));
  const text = report.checks
    .map((c) => {
      const first = `${mark[c.state](c.state.padEnd(7))} ${p.name(c.name.padEnd(width))}  ${c.detail}`;
      return c.fix ? `${first}\n${" ".repeat(8 + width + 2)}${p.dim(`→ ${c.fix}`)}` : first;
    })
    .join("\n");
  // `part`, `version` and `contract` let a program that runs several tools' doctors tell this one's report apart.
  return {
    data: { part: "kioku", version: VERSION, contract: CLI_CONTRACT, ...report },
    text,
    ...(!report.ok && { exit: 1 }),
  };
};

/** How the tool was installed and where its plugin is beside it (§6.2, §6.4), for doctor to hold the host's to. */
function besideTool(ctx: Parameters<Handler>[1]) {
  const dirs = installDirs(personHome(ctx), ctx.env);
  const origin = installOrigin(dirs, ctx.bundle);
  const folder = pluginFolder(dirs, origin, ctx.bundle);
  return { origin, ...(folder !== undefined && { pluginFolder: folder }) };
}
