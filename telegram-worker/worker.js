// Cloudflare Worker: принимает заявку с сайта и пересылает её в Telegram.
// Секреты BOT_TOKEN и CHAT_ID задаются в Cloudflare, в коде их нет.

const LIMITS = { name: 80, contact: 80, type: 40, message: 1000 };
const RATE = { max: 5, windowMs: 60_000 }; // не больше 5 заявок в минуту с одного IP
const hits = new Map(); // простой лимит в памяти (на один экземпляр воркера)

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin)
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        }
      : { Vary: 'Origin' };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
      });

    if (!allowed.includes(origin)) return json({ ok: false, error: 'origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

    // Rate limit по IP
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
    if (recent.length >= RATE.max) return json({ ok: false, error: 'too many requests' }, 429);
    recent.push(now);
    hits.set(ip, recent);

    let data;
    try {
      const raw = await request.text();
      if (raw.length > 10_000) return json({ ok: false, error: 'payload too large' }, 413);
      data = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: 'invalid json' }, 400);
    }
    if (!data || typeof data !== 'object') return json({ ok: false, error: 'invalid json' }, 400);

    // Honeypot: живой человек это поле не видит и не заполняет
    if (typeof data.website === 'string' && data.website.trim() !== '') return json({ ok: true });

    const clean = (key) => (typeof data[key] === 'string' ? data[key].trim().slice(0, LIMITS[key]) : '');
    const name = clean('name');
    const contact = clean('contact');
    const type = clean('type');
    const message = clean('message');
    if (!name || !contact) return json({ ok: false, error: 'name and contact are required' }, 400);

    if (!env.BOT_TOKEN || !env.CHAT_ID) return json({ ok: false, error: 'server not configured' }, 500);

    const when = new Date().toLocaleString('ru-RU', {
      timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    // Ссылка для быстрого ответа: @username → t.me, номер → wa.me
    const handle = contact.match(/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/);
    // 8 7xx… (местный формат KZ) → 7 7xx…, иначе wa.me не откроет чат
    const digits = contact.replace(/[^\d]/g, '').replace(/^8(?=7\d{9}$)/, '7');
    const reply = handle
      ? `https://t.me/${handle[1]}`
      : digits.length >= 10 && /^[+\d\s()-]+$/.test(contact) ? `https://wa.me/${digits}` : '';

    const text = [
      '📩 Новая заявка с сайта',
      '',
      `👤 Имя: ${name}`,
      `📱 Контакт: ${contact}`,
      `🧩 Что нужно: ${type || '—'}`,
      `💬 Сообщение: ${message || '—'}`,
      '',
      `🕒 ${when}`,
      ...(reply ? [`Ответить: ${reply}`] : []),
    ].join('\n');

    try {
      const tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Без parse_mode: текст уходит как есть, разметку внедрить нельзя
        body: JSON.stringify({ chat_id: env.CHAT_ID, text, disable_web_page_preview: true }),
      });
      if (!tg.ok) return json({ ok: false, error: 'telegram error' }, 502);
    } catch {
      return json({ ok: false, error: 'telegram unreachable' }, 502);
    }
    return json({ ok: true });
  },
};
