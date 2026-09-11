const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.chdir(require('node:path').resolve(__dirname, '..'));

const {
  readAndValidateCatalogs,
  validatePrices,
  validateActions,
  validatePartnerships,
} = require('../src/catalogs');

describe('catálogos oficiais', () => {
  it('valida preços, ações e parcerias atuais', () => {
    const result = readAndValidateCatalogs();
    assert.deepEqual(result.errors, []);
    assert.ok(result.catalogs.prices.length >= 20);
    assert.ok(result.catalogs.actions.length >= 20);
    assert.equal(result.catalogs.partnerships.length, 4);
    const ids = new Set(result.catalogs.prices.map((item) => item.id));
    assert.equal(ids.size, result.catalogs.prices.length);
  });

  it('rejeita catálogo de preço inválido', () => {
    const errors = validatePrices([
      { id: 'bad', label: 'X', aliases: ['x'] },
    ]);
    assert.ok(errors.some((item) => /unit ou without/.test(item)));
  });

  it('rejeita ação sem armas e parceria sem horário', () => {
    const actionErrors = validateActions([
      {
        id: 'x',
        label: 'X',
        aliases: ['x'],
        min: 1,
        max: 1,
        bandits: '1',
        police: '1',
        negotiation: 'n',
        hostage: 'n',
        weapons: [],
      },
    ]);
    assert.ok(actionErrors.some((item) => /weapons/.test(item)));
    const partnerErrors = validatePartnerships([
      { id: 'x', label: 'X', aliases: ['x'], role: 'r' },
    ]);
    assert.ok(partnerErrors.some((item) => /hours/.test(item)));
  });
});
