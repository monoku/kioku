import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isFrontPageAt, listMarkdown } from "../brain/brain.ts";
import { parseBrainFile } from "../brain/file.ts";
import { placementOf } from "../brain/kinds.ts";
import type { Index } from "./db.ts";

/** A brain to index: its canonical key and its folder. */
export interface IndexedBrain {
  key: string;
  root: string;
}

export interface IndexReport {
  indexed: number;
  removed: number;
  unchanged: number;
}

interface Row {
  rowid: number;
  path: string;
  hash: string;
}

/** `deprecated` for a retired page, `superseded` for a decision a newer one replaced (§3.5), null for a current page. */
const statusOf = (front: { getString(key: string): string | undefined }): string | null =>
  front.getString("status") ?? (front.getString("superseded_by") === undefined ? null : "superseded");

/**
 * Bring the index up to date with the brains' files by content hash (§4.3): pages whose hash changed are
 * indexed again, pages that are gone are removed. A hash walk, no model; cheap enough to run before every search.
 * Pages whose front matter cannot be read are left out: the validator reports them.
 */
export function updateIndex(index: Index, brains: IndexedBrain[]): IndexReport {
  const { db } = index;
  const report: IndexReport = { indexed: 0, removed: 0, unchanged: 0 };
  const known = db.prepare("SELECT rowid, path, hash FROM pages WHERE brain = ?");
  const removePage = db.prepare("DELETE FROM pages WHERE rowid = ?");
  const removeText = db.prepare("DELETE FROM fts WHERE rowid = ?");
  const removeVector = db.prepare("DELETE FROM vectors WHERE brain = ? AND path = ?");
  const removeParts = db.prepare("DELETE FROM parts WHERE brain = ? AND path = ?");
  const insertPage = db.prepare(
    "INSERT INTO pages (brain, path, id, kind, sub, namespace, status, title, aliases, summary, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rowid",
  );
  const insertText = db.prepare("INSERT INTO fts (rowid, title, aliases, summary, body) VALUES (?, ?, ?, ?, ?)");
  const removeApplies = db.prepare("DELETE FROM applies WHERE brain = ? AND path = ?");
  const insertApplies = db.prepare("INSERT INTO applies (brain, path, hash, glob) VALUES (?, ?, ?, ?)");

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const brain of brains) {
      const rows = new Map((known.all(brain.key) as unknown as Row[]).map((r) => [r.path, r]));
      for (const path of listMarkdown(brain.root).filter((p) => !isFrontPageAt(p))) {
        const text = readFileSync(join(brain.root, path), "utf8");
        const hash = createHash("sha1").update(text).digest("hex");
        const old = rows.get(path);
        rows.delete(path);
        if (old?.hash === hash) {
          report.unchanged++;
          continue;
        }
        const parsed = parseBrainFile(text);
        if (old) {
          removePage.run(old.rowid);
          removeText.run(old.rowid);
        }
        removeApplies.run(brain.key, path);
        if (!parsed.ok) {
          removeVector.run(brain.key, path);
          removeParts.run(brain.key, path);
          continue;
        }
        const { front, body } = parsed.file;
        const place = placementOf(path);
        const title = front.getString("title") ?? path;
        const aliases = (front.getList("aliases") ?? []).join(" ");
        const summary = front.getString("summary") ?? "";
        const row = insertPage.get(
          brain.key,
          path,
          front.getString("id") ?? null,
          front.getString("kind") ?? null,
          place?.sub ?? null,
          front.getString("namespace") ?? null,
          statusOf(front),
          title,
          aliases,
          summary,
          hash,
        ) as { rowid: number };
        insertText.run(row.rowid, title, aliases, summary, body);
        for (const glob of front.getList("applies_to") ?? []) insertApplies.run(brain.key, path, hash, glob);
        report.indexed++;
      }
      for (const gone of rows.values()) {
        removePage.run(gone.rowid);
        removeText.run(gone.rowid);
        removeVector.run(brain.key, gone.path);
        removeParts.run(brain.key, gone.path);
        removeApplies.run(brain.key, gone.path);
        report.removed++;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  markApplies(index);
  return report;
}

/** Keep the marker beside the index (§4.7) as the index is: there while a page says which files it is about. */
function markApplies(index: Index): void {
  try {
    const { n } = index.db.prepare("SELECT count(*) AS n FROM applies").get() as { n: number };
    if (n > 0) writeFileSync(`${index.file}.applies`, "");
    else rmSync(`${index.file}.applies`, { force: true });
  } catch {
    /* a marker is only a shortcut: without it the hook is not run, and the next index puts it back */
  }
}

/** Drop every page and vector of these brains from the index (§2.5): what `brain remove` leaves no trace of. Returns how many pages went. */
export function dropFromIndex(index: Index, keys: string[]): number {
  const { db } = index;
  const pages = db.prepare("SELECT rowid FROM pages WHERE brain = ?");
  const removePage = db.prepare("DELETE FROM pages WHERE rowid = ?");
  const removeText = db.prepare("DELETE FROM fts WHERE rowid = ?");
  const removeVectors = db.prepare("DELETE FROM vectors WHERE brain = ?");
  const removeAllParts = db.prepare("DELETE FROM parts WHERE brain = ?");
  let dropped = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const key of keys) {
      for (const row of pages.all(key) as unknown as { rowid: number }[]) {
        removePage.run(row.rowid);
        removeText.run(row.rowid);
        dropped++;
      }
      removeVectors.run(key);
      removeAllParts.run(key);
      db.prepare("DELETE FROM applies WHERE brain = ?").run(key);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  markApplies(index);
  return dropped;
}
