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
assert.ok(body.text.startsWith('Новая заявка с сайта\nИмя: Айгерим\nКонтакт: @aigerim\nЧто нужно: Лендинг\nСообщение: <b>x</b>'));
assert.equal(body.text.split('Сообщение: ')[1].length, 1000);

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
