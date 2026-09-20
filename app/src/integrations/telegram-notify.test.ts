import { afterEach, describe, expect, it, vi } from "vitest";
import { redact } from "../core/log.js";
import type { Lead } from "../core/types.js";
import { formatTelegramMessage, telegramNotify } from "./telegram-notify.js";

const lead: Lead = {
  id: "ld_0003",
  name: "Ірина Тестова",
  email: "iryna@studio-nova.example.test",
  phone: "+380 (00) 000-00-00",
  source: "referral",
  budgetUsd: 2500,
  createdAt: "2026-09-10T10:15:00.000Z",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("telegram-notify", () => {
  it("форматує повідомлення без email і телефону", () => {
    const text = formatTelegramMessage(lead);
    expect(text).toContain("Ірина Тестова");
    expect(text).not.toContain(lead.email);
    expect(text).not.toContain("+380");
  });

  it("повертає помилку, якщо не задано TELEGRAM_BOT_TOKEN", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123456");
    await expect(telegramNotify.send(lead)).resolves.toEqual({
      ok: false,
      error: "missing environment variable TELEGRAM_BOT_TOKEN",
    });
  });

  it("надсилає повідомлення в чат", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "fake-bot-token-0000");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123456");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await telegramNotify.send(lead);

    expect(result).toEqual({ ok: true, value: undefined });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botfake-bot-token-0000/sendMessage");
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: "123456",
      text: formatTelegramMessage(lead),
    });
  });

  it("повертає помилку, якщо Telegram відповів ok: false", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "fake-bot-token-0000");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123456");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"ok":false,"description":"chat not found"}', { status: 200 })),
    );

    await expect(telegramNotify.send(lead)).resolves.toEqual({
      ok: false,
      error: "telegram error: chat not found",
    });
  });

  it("маскує токен бота у власному URL через redact() з core/log.ts", () => {
    // The bot token has to be in the URL (Telegram's Bot API has no header
    // auth), and core/http.ts logs that url verbatim on a failed attempt.
    // core/http.ts and core/log.ts are protected and out of scope here —
    // this verifies the existing redact() protection actually covers the
    // exact URL shape telegram-notify.ts builds, using no console access:
    // redact() is core's own public API, so calling it directly is the
    // precise thing to check, rather than spying on console to observe an
    // effect one step removed from it.
    const realisticToken = "1234567890:FAKEtelegramTestSecretToken1234567890";
    const url = `https://api.telegram.org/bot${realisticToken}/sendMessage`;

    const redacted = redact(url);

    expect(redacted).not.toContain(realisticToken);
    expect(redacted).toContain("bot<REDACTED>");
  });
});
