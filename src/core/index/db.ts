import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { indexPath } from "../state.ts";
import type { DatabaseSync } from "node:sqlite";

/**
 * The derived index (§4.3): one SQLite file under `~/.kioku/`. It never travels between machines (§2.5) and is
 * disposable: whatever is wrong with it, it is deleted and built again from the brains' files.
 */
export { indexPath };

/** Bump when the tables, the tokenizer or what is indexed changes: an index of another version is rebuilt. */
export const SCHEMA_VERSION = 5;

export interface Index {
  db: DatabaseSync;
  /** The index's file, beside which the marker of `appliesMarkerPath` is kept. */
  file: string;
  close(): void;
}

/**
 * The files a page says it is about (§3.3, `applies_to`), one row a glob, with the hash of the page it was read from:
 * a row whose hash is not its page's is not current. Made here beside the versioned tables, not by raising
 * `SCHEMA_VERSION`, which would have every machine read the meaning of every page again for a table that starts empty:
 * no page has the field until it is written, and a page written is indexed again.
 */
const APPLIES_TABLE = `
  CREATE TABLE IF NOT EXISTS applies (
    brain TEXT NOT NULL,
    path TEXT NOT NULL,
    hash TEXT NOT NULL,
    glob TEXT NOT NULL
  )`;

/**
 * A file that exists while the index holds a page with `applies_to`: the plugin's wrapper looks for it before it
 * starts the tool on every file the agent reads or changes (§4.7), so a machine with no such page pays nothing.
 */
export const appliesMarkerPath = (home: string): string => `${indexPath(home)}.applies`;

/** `column IN (?, …)` for these brains (keys), to be given the brains as its parameters. */
export const brainIn = (brains: string[], column = "p.brain"): string =>
  `${column} IN (${brains.map(() => "?").join(", ")})`;

type SqliteModule = typeof import("node:sqlite");

/** `node:sqlite` is experimental on some Node versions and says so on stderr; nothing the person runs should print that. */
async function loadSqlite(): Promise<SqliteModule> {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning.message;
    if (/sqlite/i.test(text)) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
}

function create(sqlite: SqliteModule, path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new sqlite.DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (version !== SCHEMA_VERSION) {
    if (version !== 0) throw new Error(`index schema ${version} is not ${SCHEMA_VERSION}`);
    db.exec(`
      CREATE TABLE pages (
        rowid INTEGER PRIMARY KEY,
        brain TEXT NOT NULL,
        path TEXT NOT NULL,
        id TEXT,
        kind TEXT,
        sub TEXT,
        namespace TEXT,
        status TEXT,
        title TEXT NOT NULL,
        aliases TEXT NOT NULL,
        summary TEXT NOT NULL,
        hash TEXT NOT NULL,
        UNIQUE (brain, path)
      );
      CREATE VIRTUAL TABLE fts USING fts5(
        title, aliases, summary, body,
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3 4'
      );
      CREATE TABLE vectors (
        brain TEXT NOT NULL,
        path TEXT NOT NULL,
        hash TEXT NOT NULL,
        model TEXT NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (brain, path)
      );
      CREATE TABLE parts (
        brain TEXT NOT NULL,
        path TEXT NOT NULL,
        part INTEGER NOT NULL,
        hash TEXT NOT NULL,
        model TEXT NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (brain, path, part)
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }
  db.exec(APPLIES_TABLE);
  db.prepare("SELECT count(*) FROM pages").get(); // a corrupt file fails here, not later
  return db;
}

const removeFiles = (path: string): void => {
  for (const suffix of ["", "-wal", "-shm", ".applies"]) rmSync(path + suffix, { force: true });
};

/**
 * Open the index only as it is: undefined when there is none, or one of another version or that does not read. Never
 * creates, rebuilds or deletes it, so a reader that must not index (the prompt's recall, §4.7) leaves it to `sync`,
 * which may be writing it at that moment.
 */
export async function openIndexAsItIs(home: string): Promise<Index | undefined> {
  const path = indexPath(home);
  if (!existsSync(path)) return undefined;
  const sqlite = await loadSqlite();
  let db: DatabaseSync | undefined;
  try {
    db = new sqlite.DatabaseSync(path);
    db.exec("PRAGMA busy_timeout = 5000");
    const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version !== SCHEMA_VERSION) {
      db.close();
      return undefined;
    }
    const open = db;
    return { db: open, file: path, close: () => open.close() };
  } catch {
    db?.close();
    return undefined;
  }
}

/**
 * Open the index, creating it. A missing file is created; one of another schema version, or a corrupt one, is
 * deleted and created again, with no error shown.
 */
export async function openIndex(home: string): Promise<Index> {
  const sqlite = await loadSqlite();
  const path = indexPath(home);
  let db: DatabaseSync;
  try {
    db = create(sqlite, path);
  } catch {
    removeFiles(path);
    db = create(sqlite, path);
  }
  return { db, file: path, close: () => db.close() };
}
