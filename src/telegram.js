export class Telegram {
  constructor({ token, chatId, chatIds }) {
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
    this.token = token;
    this.setChatIds(chatIds || chatId || "");
  }

  setChatIds(chatIds) {
    const list = Array.isArray(chatIds) ? chatIds : String(chatIds || "").split(",");
    this.chatIds = [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
  }

  async send(text) {
    if (!this.chatIds.length) throw new Error("No Telegram recipients configured");
    const failures = [];
    for (const chatId of this.chatIds) {
      try {
        await this.sendTo(chatId, text);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new Error(failures.map((error) => error.message).join("; "));
    }
  }

  async sendTo(chatId, text) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true
          })
        });

        const responseText = await response.text();
        let body;
        try {
          body = JSON.parse(responseText);
        } catch {
          body = { raw: responseText };
        }
        if (!response.ok || !body.ok) {
          throw new Error(`Telegram sendMessage failed for chat ${chatId}: ${response.status} ${JSON.stringify(body)}`);
        }
        const messageId = body.result?.message_id;
        console.log(`[Telegram] Sent message to chat ${chatId}${messageId ? `, message ${messageId}` : ""}`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }

    throw new Error(`Telegram sendMessage failed for chat ${chatId}: ${lastError?.message || lastError}`);
  }

  async getUpdates(offset) {
    const url = new URL(`https://api.telegram.org/bot${this.token}/getUpdates`);
    if (offset) url.searchParams.set("offset", String(offset));
    url.searchParams.set("timeout", "0");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    return data.result || [];
  }
}
