'use strict';

const { Command } = require('commander');

//параметри командного рядка 
const program = new Command();

program
  //за замовчуванням commander займає -h під --help, тому звільняємо його.
  .helpOption('--help', 'показати довідку')
  .requiredOption('-h, --host <address>', 'адреса, на якій працює сервер')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'шлях до теки кешу');

program.parse();

//запуск 
async function main() {
  const { host, port: portText, cache } = program.opts();

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    program.error(`error: port має бути цілим числом від 0 до 65535, отримано "${portText}"`);
  }

  console.log(`host=${host}, port=${port}, cache=${cache}`);
}

main();