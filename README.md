# Заявки с сайта в Telegram (Cloudflare Worker)

Форма на сайте отправляет заявку в маленький сервер (Cloudflare Worker), а он пересылает её вам в Telegram.
Токен бота хранится только в Cloudflare. В `index.html` и на GitHub его нет.

**Бесплатно:** на бесплатном тарифе Cloudflare Workers даёт 100 000 запросов в день. Для формы заявок этого хватит с большим запасом.

> **Важно:** никогда не вставляйте токен бота в `index.html`, `wrangler.toml` или любой другой файл, который попадает на GitHub.
> Если токен всё-таки утёк, откройте @BotFather → `/revoke` и получите новый.

---

## Шаг 1. Создайте бота и получите токен

1. Откройте в Telegram [@BotFather](https://t.me/BotFather).
2. Отправьте `/newbot`.
3. Введите имя бота (любое, например «Заявки с сайта»).
4. Введите username бота, он должен заканчиваться на `bot` (например `my_leads_bot`).
5. BotFather пришлёт **токен**, примерно такой: `1234567890:AAH...xyz`. Сохраните его, это и есть `BOT_TOKEN`.

## Шаг 2. Узнайте свой CHAT_ID

1. Найдите своего нового бота в Telegram и нажмите **Start** (или отправьте `/start`).
2. Откройте в браузере ссылку, подставив свой токен вместо `<TOKEN>`:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Найдите в ответе фрагмент `"chat":{"id":123456789,...}`. Число после `"id":` и есть ваш `CHAT_ID`.
   Если ответ пустой (`"result":[]`), ещё раз напишите боту любое сообщение и обновите страницу.

## Шаг 3. Разверните воркер

Выберите **один** из двух способов.

### Способ А. Через сайт Cloudflare (без командной строки)

1. Зарегистрируйтесь на [dash.cloudflare.com](https://dash.cloudflare.com) (бесплатно).
2. Слева откройте **Workers & Pages** → **Create** → **Create Worker** (шаблон «Hello World»).
3. Назовите воркер `portfolio-leads` и нажмите **Deploy**.
4. Нажмите **Edit code**, удалите весь код и вставьте содержимое файла `worker.js`. Нажмите **Deploy**.
5. Вернитесь к воркеру → **Settings** → **Variables and Secrets** → **Add**:
   - `BOT_TOKEN`: тип **Secret** (зашифрованный), значение: токен из шага 1;
   - `CHAT_ID`: тип **Secret**, значение: число из шага 2;
   - `ALLOWED_ORIGIN`: тип **Text** (обычная переменная), значение: адрес вашего сайта, например
     `https://username.github.io`. Можно несколько через запятую:
     `https://username.github.io,https://my-site.pages.dev`.
     Пишите без слэша в конце и без пути (`/portfolio/` не нужен).
6. Нажмите **Deploy**, чтобы сохранить.
7. Скопируйте адрес воркера сверху, вида `https://portfolio-leads.<ваш-ник>.workers.dev`.

### Способ Б. Через командную строку (нужен Node.js)

```bash
cd telegram-worker
# откройте wrangler.toml и замените ALLOWED_ORIGIN на адрес своего сайта
npx wrangler login                  # откроется браузер для входа в Cloudflare
npx wrangler secret put BOT_TOKEN   # вставьте токен и нажмите Enter
npx wrangler secret put CHAT_ID     # вставьте chat id и нажмите Enter
npx wrangler deploy
```

После `deploy` в консоли появится адрес воркера `https://portfolio-leads.<ваш-ник>.workers.dev`.

## Шаг 4. Подключите форму на сайте

В `index.html` найдите строку

```js
var FORM_ENDPOINT = '';
```

и вставьте туда адрес воркера:

```js
var FORM_ENDPOINT = 'https://portfolio-leads.<ваш-ник>.workers.dev';
```

Воркер принимает **JSON**, поэтому форма должна отправлять данные так:

```js
fetch(FORM_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: f.elements['name'].value,
    contact: f.elements['contact'].value,
    type: f.elements['type'].value,
    message: f.elements['message'].value,
    website: f.elements['website'] ? f.elements['website'].value : ''
  })
})
```

Для защиты от спам-ботов добавьте в форму скрытое поле-ловушку (человек его не видит, а бот заполняет):

```html
<input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
```

Сохраните, загрузите сайт на GitHub Pages или Cloudflare Pages и отправьте тестовую заявку. Она должна прийти в Telegram.

---

## Что умеет воркер

- принимает только `POST` с вашего сайта (адреса из `ALLOWED_ORIGIN`), остальным отвечает ошибкой 403;
- проверяет, что имя и контакт заполнены, и обрезает длинные поля (имя и контакт до 80 символов, тип до 40, сообщение до 1000);
- молча игнорирует заявки, где заполнено скрытое поле `website` (спам-боты);
- не больше 5 заявок в минуту с одного IP;
- отправляет текст в Telegram без разметки, поэтому подставить ссылки или форматирование в сообщение нельзя.

Ответы: `{"ok":true}` при успехе, иначе `{"ok":false,"error":"..."}` с кодом 400, 403, 405, 413, 429, 500 или 502.

## Если не работает

- **Ошибка 403 / CORS в консоли браузера.** Проверьте `ALLOWED_ORIGIN`: он должен точно совпадать с адресом сайта (`https://`, без `/` в конце).
- **Ошибка 502.** Неверный `BOT_TOKEN` или `CHAT_ID`, либо вы не нажали Start у бота.
- **Ошибка 500 «server not configured».** Секреты `BOT_TOKEN` / `CHAT_ID` не добавлены.
- Логи воркера: Cloudflare → ваш воркер → **Logs** (или `npx wrangler tail`).

## Локальный тест

```bash
node test/worker.test.mjs
```

Тест не ходит в сеть: запрос в Telegram подменён.
