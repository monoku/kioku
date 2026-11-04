// The version of a JSON file the release sets (§6.4), written into its text so that every other byte stays as the
// formatter laid it out: rewriting the whole file would undo the formatter, and the release's own lint would refuse it.

/** `text`, a JSON object's, with its top-level `version` set to `version`; throws when it has none to set. */
export function withVersion(text, version) {
  const at = /^(\s*"version"\s*:\s*")[^"]*(")/m;
  if (!at.test(text)) throw new Error('no "version" field to set');
  const out = text.replace(at, `$1${version}$2`);
  if (JSON.parse(out).version !== version) throw new Error('the first "version" field is not the top-level one');
  return out;
}
