// Сповіщення про новий лід у Telegram-чат.
import { readEnv } from "../core/config.js";
import { postJson } from "../core/http.js";
import { log } from "../core/log.js";
import { isRecord, isString, parseJson } from "../core/parse.js";
import type { Integration, Lead, Result } from "../core/types.js";

interface TelegramResponse {
  ok: boolean;
  description?: string;
}

const isTelegramResponse = (value: unknown): value is TelegramResponse =>
  isRecord(value) &&
  typeof value.ok === "boolean" &&
  (value.description === undefined || isString(value.description));

export function formatTelegramMessage(lead: Lead): string {
  const budget = lead.budgetUsd === undefined ? "бюджет не вказано" : `бюджет $${lead.budgetUsd}`;
  return `Новий лід: ${lead.name} · ${lead.source} · ${budget}`;
}

export const telegramNotify: Integration = {
  name: "telegram-notify",
  requiredEnv: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],

  async send(lead: Lead): Promise<Result<void>> {
    const botToken = readEnv("TELEGRAM_BOT_TOKEN");
    if (!botToken.ok) return botToken;
    const chatId = readEnv("TELEGRAM_CHAT_ID");
    if (!chatId.ok) return chatId;

    // The bot token has to be in the URL — Telegram's Bot API has no header-
    // based auth. postJson (core/http.ts) logs this url verbatim on a failed
    // attempt, and that log call is redacted by core/log.ts's existing
    // bot\d{6,}:[A-Za-z0-9_-]{20,} pattern, which matches Telegram's real
    // token shape. core/http.ts and core/log.ts are protected
    // (.claude/rules/do-not-touch.md) — further hardening here (e.g. for a
    // non-standard token shape) would be a core change, not something to
    // patch around from this file. See telegram-notify.test.ts for the
    // regression test that proves this redaction actually happens.
    const url = `https://api.telegram.org/bot${botToken.value}/sendMessage`;
    // retries: 0 — a retry after Telegram already accepted the message but the
    // client saw a transport error would resend it; there's no dedup key.
    const response = await postJson(
      url,
      { chat_id: chatId.value, text: formatTelegramMessage(lead) },
      { retries: 0 },
    );
    if (!response.ok) {
      log.error(`telegram-notify: lead ${lead.id} not delivered: ${response.error}`);
      return response;
    }

    const parsed = parseJson(response.value, isTelegramResponse, "telegram-notify");
    if (!parsed.ok) return parsed;

    if (!parsed.value.ok) {
      const description = parsed.value.description ?? "unknown error";
      log.error(`telegram-notify: lead ${lead.id} rejected: ${description}`);
      return { ok: false, error: `telegram error: ${description}` };
    }

    log.info(`telegram-notify: lead ${lead.id} delivered`);
    return { ok: true, value: undefined };
  },
};
