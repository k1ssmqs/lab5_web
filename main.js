'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { once } = require('events');
const { Command } = require('commander');

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
  //поки що жоден метод не реалізований
  sendText(res, 501, 'Not Implemented');
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
    await once(server, 'listening'); // проміс замість колбека listen()

    console.log(`Проксі працює на http://${host}:${server.address().port}, кеш: ${cacheDir}`);
  } catch (err) {
    console.error(`Не вдалося запустити сервер: ${err.message}`);
    process.exit(1);
  }
}

main();