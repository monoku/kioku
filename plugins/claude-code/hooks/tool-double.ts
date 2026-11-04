// For the mod's tests: the tool beneath the plugin, as `process.run` answers it.

/** What `process.run` answers for a tool that printed this object as its JSON line, or nothing. */
export const printed = (answer?: unknown) =>
  ({
    value: {
      exitCode: 0,
      stdout: answer === undefined ? "" : `${JSON.stringify(answer)}\n`,
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }) as never;
