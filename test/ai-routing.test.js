const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

process.chdir(require('node:path').resolve(__dirname, '..'));

const {
  resolveStructuredCards,
  questionTheme,
  inspectQuestion,
  isWeakSearch,
} = require('../src/ai');
const { searchRules, reloadKnowledge } = require('../src/knowledge');

function ids(cards) {
  return (cards || []).map((card) => card.id);
}

function numberedLines(body) {
  return String(body || '')
    .split('\n')
    .filter((line) => /^\*\*\d/.test(line) || /^\*\*sem /.test(line))
    .join('\n');
}

describe('roteamento da IA', () => {
  before(() => {
    reloadKnowledge();
  });

  it('lista todas as ações sem misturar parcerias', () => {
    const hit = resolveStructuredCards({
      question: 'Lista todas as ações para mim',
      followUp: false,
    });
    assert.equal(hit.theme, 'action');
    assert.match(hit.cards[0].body, /Ammunation/);
    assert.doesNotMatch(numberedLines(hit.cards[0].body), /Iraque|Galaxy|Alaska|Seita/);
    assert.ok(hit.cards[0].body.length <= 1900);
  });

  it('reconhece variações de “quais são as ações”', () => {
    for (const question of [
      'Liste as ações da cidade',
      'e quais sao as ações da cidade?',
      'quais são as ações da cidade',
      'sobre acoes',
      'ações da cidade',
    ]) {
      const hit = resolveStructuredCards({ question, followUp: false });
      assert.ok(hit, `não listou: ${question}`);
      assert.equal(hit.theme, 'action');
      assert.match(hit.cards[0].body, /Ammunation/, question);
      assert.doesNotMatch(hit.cards[0].body, /Queima de [Aa]rquivo/);
    }
  });

  it('menos pessoas responde só Ammunation', () => {
    const hit = resolveStructuredCards({
      question: 'As que precisam de menos pessoas',
      followUp: true,
      prior: { theme: 'action', ids: ['lista'] },
    });
    assert.deepEqual(ids(hit.cards), ['menor']);
    assert.match(hit.cards[0].body, /Ammunation/);
    assert.doesNotMatch(hit.cards[0].body, /lavagem|hospital ilegal/i);
  });

  it('e a maior depois de ação responde Airdrop', () => {
    const hit = resolveStructuredCards({
      question: 'e a maior?',
      followUp: true,
      prior: { theme: 'action', ids: ['menor'] },
    });
    assert.deepEqual(ids(hit.cards), ['maior']);
    assert.match(hit.cards[0].body, /Airdrop/);
  });

  it('lockpick com parceria e depois maçarico', () => {
    const first = resolveStructuredCards({
      question: 'Quanto é lockpick com parceria?',
      followUp: false,
    });
    assert.equal(first.theme, 'price');
    assert.deepEqual(ids(first.cards), ['lockpick']);
    const second = resolveStructuredCards({
      question: 'e o maçarico?',
      followUp: true,
      prior: { theme: 'price', ids: ['lockpick'] },
    });
    assert.deepEqual(ids(second.cards), ['macarico']);
  });

  it('e sem parceria reusa o item anterior', () => {
    const hit = resolveStructuredCards({
      question: 'e sem parceria?',
      followUp: true,
      prior: { theme: 'price', ids: ['lockpick'] },
    });
    assert.equal(hit.theme, 'price');
    assert.deepEqual(ids(hit.cards), ['lockpick']);
    assert.match(hit.cards[0].body, /Sem parceria/);
  });

  it('parcerias e Seita / hospital ilegal', () => {
    const all = resolveStructuredCards({
      question: 'Quais parcerias?',
      followUp: false,
    });
    assert.equal(all.theme, 'partner');
    assert.equal(all.cards.length, 4);
    const seita = resolveStructuredCards({
      question: 'e a Seita?',
      followUp: true,
      prior: { theme: 'partner', ids: ids(all.cards) },
    });
    assert.deepEqual(ids(seita.cards), ['seita']);
    const hospital = resolveStructuredCards({
      question: 'hospital ilegal',
      followUp: false,
    });
    assert.deepEqual(ids(hospital.cards), ['seita']);
    const horario = resolveStructuredCards({
      question: 'e o horário?',
      followUp: true,
      prior: { theme: 'partner', ids: ['seita'] },
    });
    assert.deepEqual(ids(horario.cards), ['seita']);
  });

  it('RDM não vira mapa nem preço', () => {
    assert.equal(questionTheme('Qual a regra de RDM?'), 'rule');
    assert.equal(
      resolveStructuredCards({ question: 'Qual a regra de RDM?', followUp: false }),
      null,
    );
    const chunks = searchRules('Qual a regra de RDM?', 3);
    assert.ok(chunks.length > 0);
    assert.ok(
      chunks.some((row) => /rdm/i.test(`${row.section} ${row.content}`)),
    );
    assert.ok(
      !chunks.some((row) =>
        String(row.document_name).startsWith('10_parcerias'),
      ),
    );
    assert.ok(
      !chunks.some((row) => String(row.document_name).startsWith('09_precos')),
    );
    assert.equal(isWeakSearch(chunks, 'rule'), false);
  });

  it('filtra ações por fuzil e por 3 bandidos', () => {
    const fuzil = resolveStructuredCards({
      question: 'ações de fuzil',
      followUp: false,
    });
    assert.equal(fuzil.theme, 'action');
    assert.match(fuzil.cards[0].body, /Nióbio/);
    assert.doesNotMatch(fuzil.cards[0].body, /Ammunation/);
    const tres = resolveStructuredCards({
      question: 'ações com 3 bandidos',
      followUp: false,
    });
    assert.match(tres.cards[0].body, /Barbearia/);
    assert.match(tres.cards[0].body, /McDonald/);
    assert.doesNotMatch(tres.cards[0].body, /Ammunation/);
  });

  it('ficha de uma ação pelo nome', () => {
    const hit = resolveStructuredCards({
      question: 'me fala da Ammunation',
      followUp: false,
    });
    assert.deepEqual(ids(hit.cards), ['ammunation']);
    assert.match(hit.cards[0].body, /Bandidos: 2/);
    const fleeca = resolveStructuredCards({
      question: 'qual a regra da Fleeca',
      followUp: false,
    });
    assert.deepEqual(ids(fleeca.cards), ['fleeca']);
  });

  it('preço não mistura com parceria de facção', () => {
    const chunks = searchRules('quanto é lockpick com parceria', 4);
    assert.ok(chunks.length > 0);
    assert.ok(
      chunks.every((row) => String(row.document_name).startsWith('09_precos/')),
    );
  });

  it('inspectQuestion marca ficha ou recusa', () => {
    const ficha = inspectQuestion({
      question: 'Quanto é lockpick com parceria?',
    });
    assert.equal(ficha.path, 'ficha:price');
    const recusa = inspectQuestion({
      question: 'Qual a regra de RDM?',
      prior: { theme: 'partner', ids: ['seita'], query: 'quais parcerias' },
    });
    assert.equal(recusa.theme, 'rule');
    assert.equal(recusa.followUp, false);
    assert.notEqual(recusa.path, 'ficha:partner');
    assert.notEqual(recusa.path, 'ficha:price');
  });

  it('reconhece typos e intenção/entidade', () => {
    const { parseQuestion } = require('../src/ai');
    const lockpik = parseQuestion('quanto e lockpik com parceria');
    assert.equal(lockpik.theme, 'price');
    assert.ok(lockpik.entities.prices.includes('lockpick'));
    const amunation = resolveStructuredCards({
      question: 'me fala da amunation',
      followUp: false,
    });
    assert.deepEqual(ids(amunation.cards), ['ammunation']);
  });

  it('desambigua ações e parcerias juntas', () => {
    const hit = resolveStructuredCards({
      question: 'quais são as ações e as parcerias?',
      followUp: false,
    });
    assert.equal(hit.theme, 'clarify');
    assert.match(hit.cards[0].body, /ações da cidade/i);
    const info = inspectQuestion({
      question: 'quais são as ações e as parcerias?',
    });
    assert.equal(info.path, 'desambiguacao');
  });

  it('matriz de frases reais não cruza tema', () => {
    const cases = [
      ['liste as acoes', 'action'],
      ['quais sao as acoes da cidade', 'action'],
      ['acoes da cidade', 'action'],
      ['quanto e lockpick', 'price'],
      ['preco do macarico', 'price'],
      ['quais parcerias', 'partner'],
      ['hospital ilegal', 'partner'],
      ['qual a regra de RDM', 'rule'],
    ];
    for (const [question, theme] of cases) {
      assert.equal(questionTheme(question), theme, question);
      const info = inspectQuestion({ question });
      if (theme === 'rule') {
        assert.notEqual(info.path, 'ficha:partner', question);
        assert.notEqual(info.path, 'ficha:price', question);
        assert.notEqual(info.path, 'ficha:action', question);
      } else {
        assert.equal(info.path, `ficha:${theme}`, question);
      }
    }
  });
});
