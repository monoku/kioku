import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { indexPath } from "../state.ts";
import type { DatabaseSync } from "node:sqlite";

/**
 * The derived index (§4.3): one SQLite file under `~/.kioku/`. It never travels between machines (§2.5) and is
 * disposable: whatever is wrong with it, it is deleted and built again from the brains' files.
 */
export { indexPath };

/** Bump when the tables, the tokenizer or what is indexed changes: an index of another version is rebuilt. */
export const SCHEMA_VERSION = 4;

export interface Index {
  db: DatabaseSync;
  close(): void;
}

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
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }
  db.prepare("SELECT count(*) FROM pages").get(); // a corrupt file fails here, not later
  return db;
}

const removeFiles = (path: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
};

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
  return { db, close: () => db.close() };
}
