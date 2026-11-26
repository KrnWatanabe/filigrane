// Run with: node tests/money.test.js  (optional, not needed to use the app)
const assert = require('assert');
const M = require('../js/money.js');
const Mo = require('../js/model.js');

assert.deepStrictEqual(M.parseAmount('350,00'), { ok: true, cents: 35000 });
assert.deepStrictEqual(M.parseAmount('19.6'), { ok: true, cents: 1960 });
assert.deepStrictEqual(M.parseAmount(' 1 234,5 € '), { ok: true, cents: 123450 });
assert.deepStrictEqual(M.parseAmount('1.234,50'), { ok: true, cents: 123450 });
assert.strictEqual(M.parseAmount('12,345').ok, false);
assert.strictEqual(M.parseAmount('abc').ok, false);
assert.strictEqual(M.parseAmount('1,2,3').ok, false);
assert.strictEqual(M.parseAmount('').empty, true);
assert.strictEqual(M.parseAmount('0,1').cents, 10);
assert.strictEqual(M.formatCents(45780), '457,80€');
assert.strictEqual(M.formatCents(123456789), '1 234 567,89€');
assert.strictEqual(M.formatQuantity(1500), '1,5');
assert.strictEqual(M.lineTotalCents(1500, 1001), 1502);

// Invented figures that sum like a typical quote: 1 x 350 + 0.1+0.2 style traps
const doc = Mo.newDoc('devis');
doc.items = [
  { label: 'A', qty: '', price: '350,00' },
  { label: 'B', qty: '3', price: '0,10' },
  { label: 'C', qty: '3', price: '0,20' },
  { label: '', qty: '', price: '' },
];
const c = Mo.compute(doc);
assert.strictEqual(c.totalCents, 35090);
assert.strictEqual(c.hasErrors, false);
doc.items[1].price = '1,2,3';
assert.strictEqual(Mo.compute(doc).hasErrors, true);
console.log('money/model tests OK');
