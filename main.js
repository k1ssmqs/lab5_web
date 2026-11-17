'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { once } = require('events');
const { randomUUID } = require('crypto');
const { buffer } = require('stream/consumers');
const { Command } = require('commander');
const superagent = require('superagent');

//джерело картинок, якщо його треба змінити, правимо тільки цей рядок
const SOURCE_URL = 'https://http.cat';

//параметри командного рядка 
const program = new Command();

program
  //за замовчуванням commander займає -h під --help, тому звільняємо його
  .helpOption('--help', 'показати довідку')
  .requiredOption('-h, --host <address>', 'адреса, на якій працює сервер')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'шлях до теки кешу');

program.parse();

//допоміжні функції
//відповідь із текстовим повідомленням (для помилок і підтверджень)
function sendText(res, status, message, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(`${status} ${message}\n`);
}

//відповідь із картинкою; source показує, звідки вона взята: HIT або MISS
function sendImage(res, image, source) {
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': image.length,
    'X-Cache': source,
  });
  res.end(image);
}

//запис у кеш через тимчасовий файл і rename, щоб файл ніколи
//не лишався напівзаписаним (наприклад, при двох одночасних запитах)
async function saveToCache(file, data) {
  const tmp = `${file}.${randomUUID()}.tmp`; // унікальне ім'я для кожного запису
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

//запит картинки з http.cat. Повертає Buffer або кидає помилку
async function fetchFromSource(code) {
  const response = await superagent
    .get(`${SOURCE_URL}/${code}`)
    .timeout(10000)
    .buffer(true)
    .parse(superagent.parse.image);
  return response.body;
}

//обробка запитів 

function createHandler(cacheDir) {
  return async function handler(req, res) {
    try {
      await route(req, res, cacheDir);
    } catch (err) {
      //непередбачена помилка: відповідаємо 500, сервер продовжує працювати
      console.error('Помилка:', err);
      if (!res.headersSent) {
        sendText(res, 500, 'Internal Server Error');
      } else {
        res.end();
      }
    }
  };
}

async function route(req, res, cacheDir) {
  console.log(`${req.method} ${req.url}`);

  //дозволені лише три методи, решта дає 405 із заголовком Allow
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    sendText(res, 405, 'Method Not Allowed', { Allow: 'GET, PUT, DELETE' });
    return;
  }

  //код стану беремо тільки зі шляху формату /ТРИ_ЦИФРИ, інші шляхи
  //відхиляємо, тому ім'я файлу в кеші не може вийти за межі теки
  const { pathname } = new URL(req.url, 'http://localhost');
  const match = /^\/(\d{3})$/.exec(pathname);
  if (match === null) {
    sendText(res, 400, 'Bad Request: шлях має бути у вигляді /<код стану>, наприклад /200');
    return;
  }

  const code = match[1];
  const file = path.join(cacheDir, `${code}.jpg`);

  if (req.method === 'GET') {
    await handleGet(res, code, file);
  } else if (req.method === 'PUT') {
    await handlePut(req, res, file);
  } else {
    await handleDelete(res, file);
  }
}

async function handleGet(res, code, file) {
  // 1) пробуємо кеш
  try {
    const cached = await fs.readFile(file);
    sendImage(res, cached, 'HIT');
    return;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err; //це не «файлу немає», а справжня помилка диска
    }
  }

  // 2) у кеші немає: просимо в http.cat
  let image;
  try {
    image = await fetchFromSource(code);
  } catch (err) {
    const reason = err.status ? `http.cat відповів ${err.status}` : err.message;
    sendText(res, 404, `Not Found: картинки немає в кеші, а отримати її з http.cat не вдалося (${reason})`);
    return;
  }

  // 3) зберігаємо в кеш і віддаємо клієнтові
  await saveToCache(file, image);
  sendImage(res, image, 'MISS');
}

async function handlePut(req, res, file) {
  const body = await buffer(req); // тіло запиту цілком, як Buffer
  if (body.length === 0) {
    sendText(res, 400, 'Bad Request: тіло запиту порожнє, очікується картинка');
    return;
  }
  await saveToCache(file, body);
  sendText(res, 201, 'Created');
}

async function handleDelete(res, file) {
  try {
    await fs.unlink(file);
  } catch (err) {
    if (err.code === 'ENOENT') {
      sendText(res, 404, 'Not Found: такої картинки немає в кеші');
      return;
    }
    throw err;
  }
  sendText(res, 200, 'OK');
}

//запуск
async function main() {
  try {
    const { host, port: portText, cache } = program.opts();

    const port = Number(portText);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      program.error(`error: port має бути цілим числом від 0 до 65535, отримано "${portText}"`);
    }

    //тека кешу створюється до початку приймання запитів
    const cacheDir = path.resolve(cache);
    await fs.mkdir(cacheDir, { recursive: true });

    //єдиний колбек у програмі: обробник запиту
    const server = http.createServer(createHandler(cacheDir));

    server.listen(port, host);
    await once(server, 'listening'); //проміс замість колбека listen()

    console.log(`Проксі працює на http://${host}:${server.address().port}, кеш: ${cacheDir}`);
  } catch (err) {
    console.error(`Не вдалося запустити сервер: ${err.message}`);
    process.exit(1);
  }
}

main();