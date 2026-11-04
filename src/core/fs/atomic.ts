import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Called at each step of a write with the step's name. The default does nothing; a test passes one
 * that kills the process or throws, to see what a write leaves behind when it is cut short. Nothing in
 * production passes one, and nothing here reads the environment.
 */
export type Fault = (step: WriteStep) => void;

/** The steps of `writeAtomic`, in order. */
export type WriteStep = "before-tmp" | "after-tmp" | "after-fsync" | "after-rename";

const noFault: Fault = () => {};

/**
 * The atomic write: the bytes go to a temporary file in the same directory, are
 * synced, and the file is renamed into place, so a reader sees the old file or the new one and never a
 * part. The temporary name starts with a dot so an editor or the index never mistakes a leftover for a
 * page.
 */
export function writeAtomic(path: string, content: string | Uint8Array, fault: Fault = noFault): void {
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  fault("before-tmp");
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "w");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fault("after-tmp");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    fault("after-fsync");
    renameSync(tmp, path);
    fault("after-rename");
  } catch (e) {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      /* it was never created, or the rename took it */
    }
    throw e;
  }
  syncDirectory(dir);
}

/** Make the rename itself durable. Best effort: a file system that refuses to sync a directory does not fail the write. */
function syncDirectory(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* not supported here */
  }
}
