// Один запуск синхронізації. Планувальник викликає його кожні 5 хвилин.
import { log } from "../core/log.js";
import type { Integration, Lead } from "../core/types.js";
import { loadState, saveState } from "./state.js";

export interface SyncReport {
  pending: number;
  delivered: number;
  failed: number;
}

export async function runSync(
  leads: readonly Lead[],
  integrations: readonly Integration[],
  statePath: string,
): Promise<SyncReport> {
  const loaded = loadState(statePath);
  if (!loaded.ok) {
    // A corrupted state file is an error to surface, not "no state yet" —
    // continuing would silently reset lastSyncedAt to epoch and resend the
    // entire lead history. Stop instead of guessing.
    log.error(`sync: aborting, ${loaded.error}`);
    return { pending: 0, delivered: 0, failed: 0 };
  }
  const state = loaded.value;

  // Lead.createdAt isn't guaranteed unique, so the checkpoint can't be a
  // single lead's timestamp: two leads sharing one createdAt, interrupted
  // between them, would let the second get excluded forever by the strict
  // `>` filter below once the first's timestamp becomes the watermark.
  // Leads are processed in groups of equal createdAt instead, and the
  // watermark only advances past a group once every lead in it has had
  // every integration succeed.
  const pending = leads
    .filter((lead) => lead.createdAt > state.lastSyncedAt)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let delivered = 0;
  let failed = 0;
  let lastSyncedAt = state.lastSyncedAt;

  let i = 0;
  while (i < pending.length) {
    const groupCreatedAt = pending[i]!.createdAt;
    let groupOk = true;

    group: while (i < pending.length && pending[i]!.createdAt === groupCreatedAt) {
      const lead = pending[i]!;
      for (const integration of integrations) {
        const result = await integration.send(lead);
        if (result.ok) {
          delivered++;
        } else {
          // Stop the whole group right here: calling further integrations
          // for this lead, or moving on to the next lead in the group, would
          // do work that gets thrown away anyway once the group fails to
          // checkpoint — and a later lead's success in the same group would
          // otherwise be silently re-sent on retry, since nothing tracks it
          // once the group as a whole is redone from the start.
          failed++;
          groupOk = false;
          break group;
        }
      }
      i++;
    }

    // A failed delivery (Result with ok: false, not a thrown exception) must
    // not let the checkpoint pass it — otherwise the strict `>` filter would
    // exclude that lead forever on the next run instead of retrying it.
    if (!groupOk) break;

    lastSyncedAt = groupCreatedAt;
    const saved = saveState(statePath, { lastSyncedAt });
    if (!saved.ok) {
      log.error(`sync: aborting, ${saved.error}`);
      break;
    }
  }

  log.info(`sync: ${pending.length} pending leads, ${delivered} delivered, ${failed} failed`);
  return { pending: pending.length, delivered, failed };
}
