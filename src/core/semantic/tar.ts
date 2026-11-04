import { closeSync, createReadStream, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { createGunzip } from "node:zlib";

/**
 * Extract from a gzipped tar the regular files `pick` maps to a destination, streaming, skipping the rest. Enough of
 * the format for npm's tarballs: ustar names with their prefix, pax `path` records and GNU long names. `pick` is
 * given the archive's name and decides where it goes; it must refuse a name that would leave its folder.
 */
export async function extractTgz(file: string, pick: (name: string) => string | undefined): Promise<string[]> {
  const written: string[] = [];
  let buf: Buffer = Buffer.alloc(0);
  let longName: string | undefined;
  type Body = { left: number; pad: number; fd?: number; collect?: Buffer[]; meta?: "pax" | "long" };
  let body: Body | undefined;

  const finish = (b: Body): void => {
    if (b.fd !== undefined) closeSync(b.fd);
    if (b.meta === "long") longName = Buffer.concat(b.collect!).toString("utf8").replace(/\0.*$/s, "");
    if (b.meta === "pax") {
      const text = Buffer.concat(b.collect!).toString("utf8");
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
      if (path) longName = path[1];
    }
  };

  try {
    for await (const chunk of createReadStream(file).pipe(createGunzip())) {
      buf = buf.length === 0 ? (chunk as Buffer) : Buffer.concat([buf, chunk as Buffer]);
      let off = 0;
      for (;;) {
        if (body === undefined) {
          if (buf.length - off < 512) break;
          const h = buf.subarray(off, off + 512);
          off += 512;
          if (h.every((x) => x === 0)) continue;
          const size = tarNumber(h.subarray(124, 136));
          const type = String.fromCharCode(h[156]!);
          const ustarName = [cstr(h.subarray(345, 500)), cstr(h.subarray(0, 100))].filter(Boolean).join("/");
          const name = longName ?? ustarName;
          const pad = (512 - (size % 512)) % 512;
          if (type === "x" || type === "L")
            body = { left: size, pad, collect: [], meta: type === "x" ? "pax" : "long" };
          else if (type === "g") body = { left: size, pad };
          else {
            longName = undefined;
            const dest = type === "0" || type === "\0" ? pick(name) : undefined;
            let fd: number | undefined;
            if (dest !== undefined) {
              mkdirSync(dirname(dest), { recursive: true });
              fd = openSync(dest, "w");
              written.push(dest);
            }
            body = { left: size, pad, ...(fd !== undefined && { fd }) };
          }
        }
        const take = Math.min(body.left, buf.length - off);
        if (take > 0) {
          const part = buf.subarray(off, off + take);
          if (body.fd !== undefined) writeSync(body.fd, part);
          body.collect?.push(Buffer.from(part));
          off += take;
          body.left -= take;
        }
        if (body.left > 0) break;
        const skip = Math.min(body.pad, buf.length - off);
        off += skip;
        body.pad -= skip;
        if (body.pad > 0) break;
        finish(body);
        body = undefined;
      }
      buf = buf.subarray(off);
    }
  } catch (e) {
    if (body?.fd !== undefined) closeSync(body.fd);
    throw e;
  }
  if (body !== undefined) {
    finish(body);
    throw new Error(`${file} ends in the middle of an entry`);
  }
  return written;
}

const cstr = (b: Buffer): string => {
  const end = b.indexOf(0);
  return b.subarray(0, end < 0 ? b.length : end).toString("utf8");
};

/** A tar number: octal text, or base-256 when the first byte has its high bit set. */
function tarNumber(b: Buffer): number {
  if (b[0]! & 0x80) {
    let n = b[0]! & 0x7f;
    for (let i = 1; i < b.length; i++) n = n * 256 + b[i]!;
    return n;
  }
  const text = cstr(b).trim();
  return text === "" ? 0 : parseInt(text, 8);
}
