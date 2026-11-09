// Локальный тест без сети: node test/worker.test.mjs
import assert from 'node:assert/strict';
import worker from '../worker.js';

const env = { BOT_TOKEN: 'TEST_TOKEN', CHAT_ID: '12345', ALLOWED_ORIGIN: 'https://me.github.io, https://me.pages.dev' };
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  return new Response('{"ok":true}', { status: 200 });
};

let ipN = 0;
const req = (body, { method = 'POST', origin = 'https://me.github.io', raw } = {}) =>
  new Request('https://w.example/', {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.0.${++ipN}` },
    body: method === 'POST' ? raw ?? JSON.stringify(body) : undefined,
  });

// 1. Preflight от разрешённого origin
let r = await worker.fetch(req(null, { method: 'OPTIONS', origin: 'https://me.pages.dev' }), env);
assert.equal(r.status, 204);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://me.pages.dev');
assert.match(r.headers.get('Access-Control-Allow-Headers'), /Content-Type/);

// 2. Чужой origin
r = await worker.fetch(req({ name: 'a', contact: 'b' }, { origin: 'https://evil.com' }), env);
assert.equal(r.status, 403);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);

// 3. Валидация
r = await worker.fetch(req({ name: '  ', contact: 'x' }), env);
assert.equal(r.status, 400);
r = await worker.fetch(req({ name: 'A' }), env);
assert.equal(r.status, 400);
r = await worker.fetch(req(null, { raw: '{bad' }), env);
assert.equal(r.status, 400);
r = await worker.fetch(req(null, { method: 'GET' }), env);
assert.equal(r.status, 405);
assert.equal(calls.length, 0);

// 4. Honeypot: 200, но в Telegram ничего не уходит
r = await worker.fetch(req({ name: 'Bot', contact: 'x', website: 'spam.com' }), env);
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { ok: true });
assert.equal(calls.length, 0);

// 5. Нормальная заявка + обрезка длины + отсутствие parse_mode
r = await worker.fetch(req({ name: '  Айгерим  ', contact: '@aigerim', type: 'Лендинг', message: '<b>x</b>'.repeat(300), website: '' }), env);
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { ok: true });
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://me.github.io');
assert.equal(calls.length, 1);
assert.equal(calls[0].url, 'https://api.telegram.org/botTEST_TOKEN/sendMessage');
const body = JSON.parse(calls[0].init.body);
assert.equal(body.chat_id, '12345');
assert.equal(body.parse_mode, undefined);
assert.equal(body.disable_web_page_preview, true);
assert.ok(body.text.startsWith('📩 Новая заявка с сайта\n\n👤 Имя: Айгерим\n📱 Контакт: @aigerim\n🧩 Что нужно: Лендинг\n💬 Сообщение: <b>x</b>'));
// HTML остаётся буквальным текстом, сообщение обрезано до 1000 символов
const msgLine = body.text.split('💬 Сообщение: ')[1].split('\n')[0];
assert.equal(msgLine, '<b>x</b>'.repeat(300).slice(0, 1000));
assert.ok(!body.text.includes('&lt;'));
// Пустая строка, время в Asia/Almaty, ссылка t.me для @username
const tail = body.text.split('\n').slice(-3);
assert.equal(tail[0], '');
assert.match(tail[1], /^🕒 \d{2}\.\d{2}, \d{2}:\d{2}$/);
assert.equal(tail[2], 'Ответить: https://t.me/aigerim');

// 5b. Ссылка для ответа в зависимости от контакта
const replyFor = async (contact) => {
  calls.length = 0;
  const res = await worker.fetch(req({ name: 'A', contact }), env);
  assert.equal(res.status, 200);
  const t = JSON.parse(calls[0].init.body).text;
  assert.equal(JSON.parse(calls[0].init.body).parse_mode, undefined);
  const m = t.match(/\nОтветить: (\S+)$/);
  return m ? m[1] : null;
};
assert.equal(await replyFor('+7 701 234 56 78'), 'https://wa.me/77012345678');
assert.equal(await replyFor('8 (701) 234-56-78'), 'https://wa.me/77012345678');
assert.equal(await replyFor('aigerim'), 'https://t.me/aigerim');
assert.equal(await replyFor('пишите в инсту'), null);
assert.equal(await replyFor('12345'), null);
assert.equal(await replyFor('@ab'), null);
assert.equal(await replyFor('a@mail.kz'), null);
// Без типа/сообщения — прочерки, без пустых «Сообщение: »
calls.length = 0;
await worker.fetch(req({ name: 'A', contact: 'пишите в инсту' }), env);
const t2 = JSON.parse(calls[0].init.body).text;
assert.ok(t2.includes('🧩 Что нужно: —\n💬 Сообщение: —\n\n🕒 '));
assert.ok(!t2.includes('Ответить'));

// 6. Ошибка Telegram -> 502
globalThis.fetch = async () => new Response('{}', { status: 400 });
r = await worker.fetch(req({ name: 'A', contact: 'B' }), env);
assert.equal(r.status, 502);
assert.equal((await r.json()).ok, false);

// 7. Rate limit: 6-й запрос с одного IP за минуту -> 429
globalThis.fetch = async () => new Response('{}', { status: 200 });
const same = () => new Request('https://w.example/', {
  method: 'POST',
  headers: { Origin: 'https://me.github.io', 'CF-Connecting-IP': '9.9.9.9' },
  body: JSON.stringify({ name: 'A', contact: 'B' }),
});
for (let i = 0; i < 5; i++) assert.equal((await worker.fetch(same(), env)).status, 200);
assert.equal((await worker.fetch(same(), env)).status, 429);

console.log('All worker tests passed');
