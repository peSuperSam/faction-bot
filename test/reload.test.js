const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coroa-reload-'));
process.env.DATABASE_PATH = path.join(tmp, 'farm.sqlite');
process.env.RULES_PATH = path.join(tmp, 'rules');
process.chdir(path.resolve(__dirname, '..'));

fs.cpSync(path.resolve('rules'), process.env.RULES_PATH, { recursive: true });

const { reloadKnowledge, listKnowledgeDocuments } = require('../src/knowledge');

describe('recarga atômica', () => {
  it('mantém a base se o catálogo ficar inválido', () => {
    const first = reloadKnowledge();
    assert.equal(Boolean(first.aborted), false);
    assert.ok(first.indexed > 0);
    const before = listKnowledgeDocuments().map((row) => row.name).sort();
    fs.writeFileSync(
      path.join(process.env.RULES_PATH, '09_precos/catalogo.json'),
      '{nao-e-json',
    );
    const second = reloadKnowledge();
    assert.equal(second.aborted, true);
    assert.ok(second.rejected.some((item) => /Catálogo inválido/.test(item)));
    const after = listKnowledgeDocuments().map((row) => row.name).sort();
    assert.deepEqual(after, before);
  });
});
