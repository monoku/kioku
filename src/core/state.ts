import { join } from "node:path";

/**
 * What the tool keeps per machine under `~/.kioku/`, beside the brains and the configuration (§2.5): derived or
 * machine-local, never committed, rebuilt from the files when lost. Paths only, so that any entry point can name a
 * file without loading the code that writes it.
 */
const kioku = (home: string, name: string): string => join(home, ".kioku", name);

/** Where a conflict's branch is opened as a folder, per repository. */
export const conflictsPath = (home: string): string => kioku(home, "conflicts");
/** The search index (§4.3). */
export const indexPath = (home: string): string => kioku(home, "index.sqlite");
/** Publications that did not complete (§1.6). */
export const pendingPath = (home: string): string => kioku(home, "pending.json");
/** The commit of each shared brain seen by the last sessions, for "new since your last session" (§4.1). */
export const viewsPath = (home: string): string => kioku(home, "views.json");
/** The commit of each shared brain up to which the person was told of its Rules' changes (§1.2). */
export const rulesSeenPath = (home: string): string => kioku(home, "rules-seen.json");
/** The last outcome of `sync` per brain (§4.2). */
export const syncStatePath = (home: string): string => kioku(home, "sync.json");
/** What the last background `sync` printed. */
export const syncLogPath = (home: string): string => kioku(home, "sync.log");
/** One `sync` per machine at a time. */
export const syncLockPath = (home: string): string => kioku(home, "sync.lock");
/** The folders a `sync` that found another running left for it (§4.2). */
export const syncLeftPath = (home: string): string => kioku(home, "sync-left.json");
/** The maintenance report per brain (§4.4). */
export const lintReportPath = (home: string): string => kioku(home, "lint.json");
/** When the person was last told that the personal brain lives only on this machine (§2.3). */
export const backupStatePath = (home: string): string => kioku(home, "backup.json");
/** Each session's journal, one file per session, dropped thirty days after its last entry (§4.6). */
export const sessionsPath = (home: string): string => kioku(home, "sessions");
/** What this machine has opened and been offered, per page, and since when it counts (§4.5). */
export const readsStatePath = (home: string): string => kioku(home, "reads.json");
/** Where each folder's last session stopped, as the agent left it (§4.8). */
export const handoffsPath = (home: string): string => kioku(home, "handoffs");
/** The embedding engine, fetched at first use (§4.3). */
export const enginePath = (home: string): string => kioku(home, "engine");
/** The embedding model, fetched at first use (§4.3). */
export const modelsPath = (home: string): string => kioku(home, "models");
/** The pair of versions, the plugin's and the tool's, that a session last said differ (§6.2). */
export const pluginSaidPath = (home: string): string => kioku(home, "plugin-said.json");
/** When a new version was last looked for (§6.4): the daily check runs once a day, from any session. */
export const updateStatePath = (home: string): string => kioku(home, "update.json");
/** The last failure to fetch them, and whether the person was told they are being fetched. */
export const semanticStatePath = (home: string): string => kioku(home, "semantic.json");
