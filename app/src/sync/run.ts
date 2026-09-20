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
  const state = loadState(statePath);
  saveState(statePath, state); // створює файл стану при першому запуску

  const pending = leads.filter((lead) => lead.createdAt > state.lastSyncedAt);
  let delivered = 0;
  let failed = 0;
  let lastSyncedAt = state.lastSyncedAt;

  for (const lead of pending) {
    for (const integration of integrations) {
      const result = await integration.send(lead);
      if (result.ok) delivered++;
      else failed++;
    }
    // Checkpoint after each lead, not once at the end: a run that is killed
    // mid-batch (timeout, crash) must not lose credit for leads already sent,
    // or the next run resends them.
    if (lead.createdAt > lastSyncedAt) lastSyncedAt = lead.createdAt;
    saveState(statePath, { lastSyncedAt });
  }

  log.info(`sync: ${pending.length} pending leads, ${delivered} delivered, ${failed} failed`);
  return { pending: pending.length, delivered, failed };
}
