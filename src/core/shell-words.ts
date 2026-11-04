/**
 * How a shell command line is read where the tool needs to know what an agent ran (§1.2, §3.2, §4.6): the journal's
 * entries, and the hook that asks before a namespace is made. One reading, so that both answer the same for the same line.
 */

/**
 * The flags of `page search` (§4.3, §6.1), as `parseArgs` takes them: the verb parses them, and the journal reads the
 * words past them (§4.6), one table so that a flag added here is known to both.
 */
export const SEARCH_OPTIONS = {
  brain: { type: "string" },
  limit: { type: "string" },
  "include-retired": { type: "boolean" },
} as const;

/**
 * The words of a shell command as the shell splits them: quotes and backslashes undone; a `;`, `&`, `|`, `(` or `)`
 * ends a command.
 */
export function shellWords(command: string): string[][] {
  const commands: string[][] = [[]];
  let word: string | undefined;
  const end = () => {
    if (word !== undefined) commands.at(-1)!.push(word);
    word = undefined;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      word = (word ?? "") + command.slice(i + 1, close === -1 ? undefined : close);
      i = close === -1 ? command.length : close;
    } else if (c === '"') {
      word ??= "";
      for (i++; i < command.length && command[i] !== '"'; i++)
        word += command[i] === "\\" && i + 1 < command.length ? command[++i] : command[i];
    } else if (c === "\\" && i + 1 < command.length) word = (word ?? "") + command[++i];
    else if (/\s/.test(c)) end();
    else if (c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      end();
      commands.push([]);
    } else word = (word ?? "") + c;
  }
  end();
  return commands;
}

/** Whether a word is the tool, by its name or a path to it. */
const isKioku = (word: string): boolean => /(^|\/)kioku$/.test(word);

/**
 * The words after `kioku <group> <verb>` in the first command of the line that runs one of `verbs` of that group,
 * or undefined when none does.
 */
export function kiokuCall(command: string, group: string, verbs: readonly string[]): string[] | undefined {
  for (const words of shellWords(command)) {
    const at = words.findIndex((w, i) => isKioku(w) && words[i + 1] === group && verbs.includes(words[i + 2] ?? ""));
    if (at !== -1) return words.slice(at + 3);
  }
  return undefined;
}

/** What a line says once its here-documents are taken out: `<<TAG`, `<<-TAG`, `<<'TAG'` or `<<"TAG"` to the line that is `TAG`. */
function withoutHeredocs(command: string): string {
  const lines = command.split("\n");
  const out: string[] = [];
  let end: { tag: string; dash: boolean } | undefined;
  for (const line of lines) {
    if (end !== undefined) {
      if ((end.dash ? line.replace(/^\t+/, "") : line) === end.tag) end = undefined;
      continue;
    }
    out.push(line);
    const m = /<<(-?)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/.exec(line);
    if (m !== null) end = { tag: (m[2] ?? m[3] ?? m[4])!, dash: m[1] === "-" };
  }
  return out.join("\n");
}

/**
 * The words of a line that is one call to the tool and nothing else, here-documents taken out, or undefined for any
 * other line: another command, a `kioku` after a `cd` or inside a pipe, a command with something before or after it.
 * What a row is drawn for (§1.2), and what the mod reads the same way.
 */
export function plainKiokuCall(command: string): string[] | undefined {
  // `2>&1` and `>&2` join a stream to another: they are not a command's end.
  const commands = shellWords(withoutHeredocs(command).replace(/\d*>&\d+/g, "")).filter((c) => c.length > 0);
  const only = commands.length === 1 ? commands[0]! : undefined;
  return only !== undefined && isKioku(only[0]!) ? only : undefined;
}

/**
 * Whether any command of a line is a call to the tool, whatever else the line holds: what the mod draws a row for
 * when the call made entries (§1.2). `plainKiokuCall` is the line that is only one.
 */
export function runsTool(command: string): boolean {
  return shellWords(withoutHeredocs(command)).some((words) => words[0] !== undefined && isKioku(words[0]));
}
