
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function clean(value, max = 500) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lead") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      }

      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return json({ ok: false, error: "TELEGRAM_NOT_CONFIGURED" }, 503);
      }

      let payload;
      try {
        const type = request.headers.get("content-type") || "";
        if (!type.includes("application/json")) {
          return json({ ok: false, error: "JSON_REQUIRED" }, 415);
        }
        payload = await request.json();
      } catch {
        return json({ ok: false, error: "BAD_JSON" }, 400);
      }

      const name = clean(payload.name, 100);
      const phone = clean(payload.phone, 50);
      const phoneDigits = phone.replace(/\D/g, "");

      if (name.length < 2 || phoneDigits.length < 10) {
        return json({ ok: false, error: "INVALID_CONTACT" }, 400);
      }

      const car = clean(payload.car, 180) || "—";
      const carUrl = clean(payload.carUrl, 800) || "—";
      const comment = clean(payload.comment, 700) || "—";
      const city = clean(payload.city, 100) || "—";
      const country = clean(payload.country, 100) || "—";
      const budget = clean(payload.budget, 100) || "—";
      const contact = clean(payload.contact, 50) || "—";
      const page = clean(payload.page, 500) || "—";

      const text =
        "<b>🚗 Новая заявка с сайта «АВТО В РФ»</b>\n\n" +
        "<b>Имя:</b> " + escapeHtml(name) + "\n" +
        "<b>Телефон:</b> " + escapeHtml(phone) + "\n" +
        "<b>Автомобиль:</b> " + escapeHtml(car) + "\n" +
        "<b>Ссылка:</b> " + escapeHtml(carUrl) + "\n" +
        "<b>Комментарий:</b> " + escapeHtml(comment) + "\n" +
        "<b>Город:</b> " + escapeHtml(city) + "\n" +
        "<b>Страна:</b> " + escapeHtml(country) + "\n" +
        "<b>Бюджет:</b> " + escapeHtml(budget) + "\n" +
        "<b>Удобная связь:</b> " + escapeHtml(contact) + "\n\n" +
        "<b>Страница:</b> " + escapeHtml(page);

      const tgRes = await fetch(
        "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true
          })
        }
      );

      let tgData = {};
      try { tgData = await tgRes.json(); } catch {}

      if (!tgRes.ok || tgData.ok !== true) {
        console.log("Telegram send failed:", JSON.stringify(tgData));
        return json({ ok: false, error: "TELEGRAM_SEND_FAILED" }, 502);
      }

      return json({ ok: true });
    }

    return env.ASSETS.fetch(request);
  }
};
