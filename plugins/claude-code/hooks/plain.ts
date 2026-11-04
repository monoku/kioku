// Whether a shell line is one call to the tool and nothing else (§1.2). The tool's hook decides the same in
// `src/core/shell-words.ts`, which the mod cannot import: `tests/core/rows.test.ts` holds the two to the same answers.

/** The words of a shell command as the shell splits them: quotes and backslashes undone; `;`, `&`, `|`, `(` and `)` end a command. */
function shellWords(command: string): string[][] {
  const commands: string[][] = [[]];
  let word: string | undefined;
  const end = (): void => {
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

/** What a line says once its here-documents are taken out: `<<TAG`, `<<-TAG`, `<<'TAG'` or `<<"TAG"` to the line that is `TAG`. */
export function withoutHeredocs(command: string): string {
  const out: string[] = [];
  let end: { tag: string; dash: boolean } | undefined;
  for (const line of command.split("\n")) {
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

/** The words of a line that is one call to the tool, or undefined for any other line. */
export function plainKiokuCall(command: string): string[] | undefined {
  // `2>&1` and `>&2` join a stream to another: they are not a command's end.
  const commands = shellWords(withoutHeredocs(command).replace(/\d*>&\d+/g, "")).filter((c) => c.length > 0);
  const only = commands.length === 1 ? commands[0]! : undefined;
  return only !== undefined && /(^|\/)kioku$/.test(only[0]!) ? only : undefined;
}

/** A line as the transcript shows it when it fails or says nothing: its here-documents cut to `…`, so that their text does not fill the screen. */
export function shortened(command: string): string {
  const cut = withoutHeredocs(command);
  return cut === command ? command : `${cut} …`;
}

/** Whether any command of a line is a call to the tool, whatever else it holds. */
export function runsKioku(command: string): boolean {
  return shellWords(withoutHeredocs(command)).some((words) => words[0] !== undefined && /(^|\/)kioku$/.test(words[0]));
}

/** What else a line runs, the commands that are not the tool's, each as its words, for a dim line under the rows. */
export function alsoRan(command: string): string {
  return shellWords(withoutHeredocs(command))
    .filter((words) => words.length > 0 && !/(^|\/)kioku$/.test(words[0]!))
    .map((words) => words.join(" "))
    .join(" · ");
}

/** The words of the first command of a line that is the tool's, or none. */
export function kiokuWords(command: string): string[] {
  return (
    shellWords(withoutHeredocs(command)).find((words) => words[0] !== undefined && /(^|\/)kioku$/.test(words[0])) ?? []
  );
}
