// Стан синхронізації між запусками: ліди, створені після lastSyncedAt, ще не розіслані.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isRecord, isString, parseJson } from "../core/parse.js";
import type { Result } from "../core/types.js";

export interface SyncState {
  /** ISO-8601, UTC. */
  lastSyncedAt: string;
}

const INITIAL_STATE: SyncState = { lastSyncedAt: "1970-01-01T00:00:00.000Z" };

const isSyncState = (value: unknown): value is SyncState => isRecord(value) && isString(value.lastSyncedAt);

// Corrupted JSON here is a real error, not "no state yet": silently falling
// back to INITIAL_STATE would reset lastSyncedAt to epoch and resend the
// entire lead history. The caller must see this and stop, not guess.
export function loadState(path: string): Result<SyncState> {
  if (!existsSync(path)) return { ok: true, value: { ...INITIAL_STATE } };
  return parseJson(readFileSync(path, "utf8"), isSyncState, `sync state (${path})`);
}

// Write-then-rename: a rename replacing the destination is atomic, so a crash
// or a full disk mid-write (see materials/error-log.txt) can't leave a
// truncated, corrupted state file behind — the old file stays valid until the
// new one is fully written.
export function saveState(path: string, state: SyncState): void {
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, path);
}
