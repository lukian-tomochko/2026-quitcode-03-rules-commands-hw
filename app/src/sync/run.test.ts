import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("не приймає lastSyncedAt у неканонічному форматі", async () => {
    const statePath = join(dir, "sync-state.json");
    writeFileSync(statePath, JSON.stringify({ lastSyncedAt: "z" }));

    const sent: string[] = [];
    const report = await runSync(leads, [recordingIntegration(sent)], statePath);

    // A non-ISO value like "z" would otherwise pass a string-only guard and
    // sort after every real timestamp, silently excluding every lead.
    expect(report).toEqual({ pending: 0, delivered: 0, failed: 0 });
    expect(sent).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("sync: aborting"));
  });

  it("групує ліди з однаковим createdAt і не втрачає їх при перериванні всередині групи", async () => {
    const statePath = join(dir, "sync-state.json");
    const sameTs = "2026-09-09T10:00:00.000Z";
    const grouped = [makeLead("ld_a", sameTs), makeLead("ld_b", sameTs)];
    const crashing: Integration = {
      name: "crashing",
      requiredEnv: [],
      send: async (lead) => {
        if (lead.id === "ld_b") throw new Error("simulated crash");
        return { ok: true, value: undefined };
      },
    };

    await expect(runSync(grouped, [crashing], statePath)).rejects.toThrow("simulated crash");
    // The group (both leads share createdAt) never fully completed, so
    // nothing was checkpointed yet — not even ld_a's success.
    expect(existsSync(statePath)).toBe(false);

    const redelivered: string[] = [];
    await runSync(grouped, [recordingIntegration(redelivered)], statePath);
    expect(redelivered).toEqual(["ld_a", "ld_b"]);
  });

  it("зупиняє групу одразу після Result ok:false, не обробляючи інших лідів тієї ж групи", async () => {
    const statePath = join(dir, "sync-state.json");
    const sameTs = "2026-09-09T10:00:00.000Z";
    const grouped = [makeLead("ld_a", sameTs), makeLead("ld_b", sameTs)];
    const attempted: string[] = [];
    const flaky: Integration = {
      name: "flaky",
      requiredEnv: [],
      send: async (lead) => {
        attempted.push(lead.id);
        return lead.id === "ld_a" ? { ok: false, error: "simulated failure" } : { ok: true, value: undefined };
      },
    };

    const report = await runSync(grouped, [flaky], statePath);

    // ld_b shares ld_a's createdAt but must never be attempted this run:
    // delivering it here and then discarding that success (since the group
    // as a whole isn't checkpointed) would just mean redelivering it next
    // time anyway.
    expect(attempted).toEqual(["ld_a"]);
    expect(report).toEqual({ pending: 2, delivered: 0, failed: 1 });
    expect(existsSync(statePath)).toBe(false);

    const retried: string[] = [];
    await runSync(grouped, [recordingIntegration(retried)], statePath);
    expect(retried).toEqual(["ld_a", "ld_b"]);
  });

  it("не просуває checkpoint повз лід, що не був доставлений, і не пропускає його наступного разу", async () => {
    const statePath = join(dir, "sync-state.json");
    const attempted: string[] = [];
    const flaky: Integration = {
      name: "flaky",
      requiredEnv: [],
      send: async (lead) => {
        attempted.push(lead.id);
        return lead.id === "ld_0001" ? { ok: false, error: "simulated failure" } : { ok: true, value: undefined };
      },
    };

    const report = await runSync(leads, [flaky], statePath);

    // Stops at the first failed lead (ld_0001, oldest createdAt) instead of
    // skipping ahead to later leads, which would advance the watermark past
    // it and exclude it forever.
    expect(report).toEqual({ pending: 3, delivered: 0, failed: 1 });
    expect(attempted).toEqual(["ld_0001"]);
    expect(existsSync(statePath)).toBe(false);

    const retried: string[] = [];
    await runSync(leads, [recordingIntegration(retried)], statePath);
    expect(retried).toEqual(["ld_0001", "ld_0002", "ld_0003"]);
  });

  it("обробляє помилку запису стану як контрольований результат, а не необроблений виняток", async () => {
    const statePath = join(dir, "missing-subdir", "sync-state.json"); // parent dir doesn't exist
    const sent: string[] = [];

    const report = await runSync(leads, [recordingIntegration(sent)], statePath);

    // The first group (ld_0001) is delivered before the checkpoint write
    // fails (ENOENT); runSync surfaces that as a controlled abort via
    // saveState's Result instead of an unhandled rejection.
    expect(sent).toEqual(["ld_0001"]);
    expect(report).toEqual({ pending: 3, delivered: 1, failed: 0 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("sync: aborting"));
  });
});
