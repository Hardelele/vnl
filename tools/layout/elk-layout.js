// Раскладка схемы через ELK Layered.
// Граф приходит JSON-ом в stdin, результат уходит JSON-ом в stdout.
// Вызывается из vnl.layout; отдельного состояния не держит.

const ELK = require('elkjs');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', async () => {
  try {
    const graph = JSON.parse(input);
    const result = await new ELK().layout(graph);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(String((error && error.message) || error));
    process.exit(1);
  }
});
