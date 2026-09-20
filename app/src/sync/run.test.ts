import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Integration, Lead } from "../core/types.js";
import { runSync } from "./run.js";

const makeLead = (id: string, createdAt: string): Lead => ({
  id,
  name: `Lead ${id}`,
  email: `${id}@studio-nova.example.test`,
  source: "website",
  createdAt,
});

const leads = [
  makeLead("ld_0001", "2026-09-09T10:00:00.000Z"),
  makeLead("ld_0002", "2026-09-09T11:00:00.000Z"),
  makeLead("ld_0003", "2026-09-10T08:00:00.000Z"),
];

function recordingIntegration(sent: string[]): Integration {
  return {
    name: "recording",
    requiredEnv: [],
    send: async (lead) => {
      sent.push(lead.id);
      return { ok: true, value: undefined };
    },
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lead-sync-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runSync", () => {
  it("при першому запуску розсилає всі ліди і зберігає найновішу дату", async () => {
    const sent: string[] = [];
    const statePath = join(dir, "sync-state.json");

    const report = await runSync(leads, [recordingIntegration(sent)], statePath);

    expect(report).toEqual({ pending: 3, delivered: 3, failed: 0 });
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toEqual({ lastSyncedAt: "2026-09-10T08:00:00.000Z" });
  });

  it("розсилає лише ліди, новіші за збережений стан", async () => {
    const sent: string[] = [];
    const statePath = join(dir, "sync-state.json");
    writeFileSync(statePath, JSON.stringify({ lastSyncedAt: "2026-09-09T10:30:00.000Z" }));

    await runSync(leads, [recordingIntegration(sent)], statePath);

    expect(sent).toEqual(["ld_0002", "ld_0003"]);
  });

  it("зберігає прогрес по кожному ліду, щоб перерваний запуск не дублював уже надіслані", async () => {
    const statePath = join(dir, "sync-state.json");
    const crashing: Integration = {
      name: "crashing",
      requiredEnv: [],
      send: async (lead) => {
        if (lead.id === "ld_0002") throw new Error("simulated crash");
        return { ok: true, value: undefined };
      },
    };

    await expect(runSync(leads, [crashing], statePath)).rejects.toThrow("simulated crash");
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toEqual({ lastSyncedAt: "2026-09-09T10:00:00.000Z" });

    const redelivered: string[] = [];
    await runSync(leads, [recordingIntegration(redelivered)], statePath);

    expect(redelivered).not.toContain("ld_0001");
    expect(redelivered).toEqual(["ld_0002", "ld_0003"]);
  });

  it("не скидає прогрес мовчки, якщо файл стану пошкоджений", async () => {
    const statePath = join(dir, "sync-state.json");
    writeFileSync(statePath, "{not valid json");

    const sent: string[] = [];
    const report = await runSync(leads, [recordingIntegration(sent)], statePath);

    expect(report).toEqual({ pending: 0, delivered: 0, failed: 0 });
    expect(sent).toEqual([]);
    // File is left exactly as found — not silently overwritten with a fresh
    // epoch state, which is what would cause the entire lead history to be
    // treated as "pending" and resent.
    expect(readFileSync(statePath, "utf8")).toBe("{not valid json");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("sync: aborting"));
  });
});
