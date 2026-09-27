import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from '../src/render.mjs';

const ctx = {
  project: { name: 'Demo', slug: 'demo' },
  list: ['a', 'b'],
  empty: [],
  flag: false,
  hooks: [
    { name: 'typecheck', command: 'npm run typecheck' },
    { name: 'lint', command: 'npm run lint' },
  ],
  nested: { yes: true, no: '' },
};

test('variables, tableaux joints et valeurs absentes', () => {
  assert.equal(render('{{project.name}}/{{ project.slug }}', ctx), 'Demo/demo');
  assert.equal(render('[{{list}}]', ctx), '[a, b]');
  assert.equal(render('[{{absent.key}}]', ctx), '[]');
});

test('if / else / unless imbriqués', () => {
  const tpl = '{{#if nested.yes}}A{{#unless nested.no}}B{{else}}X{{/unless}}{{#if flag}}C{{else}}D{{/if}}{{/if}}';
  assert.equal(render(tpl, ctx), 'ABD');
  assert.equal(render('{{#if empty}}plein{{else}}vide{{/if}}', ctx), 'vide');
  assert.equal(render('{{#unless flag}}ok{{/unless}}', ctx), 'ok');
});

test('each sur chaînes et sur objets', () => {
  assert.equal(render('{{#each list}}<{{this}}>{{/each}}', ctx), '<a><b>');
  assert.equal(render('{{#each hooks}}{{this.name}}={{this.command}};{{/each}}', ctx),
    'typecheck=npm run typecheck;lint=npm run lint;');
  assert.equal(render('{{#each absent}}x{{/each}}', ctx), '');
});

test('échappement \\{{ en {{ littéral', () => {
  assert.equal(render('\\{{project.name}} = {{project.name}}', ctx), '{{project.name}} = Demo');
});

test('les lignes de balise de bloc disparaissent entièrement', () => {
  const tpl = [
    'début',
    '{{#if nested.yes}}',
    '  {{#each list}}',
    '- {{this}}',
    '  {{/each}}',
    '{{else}}',
    'jamais',
    '{{/if}}',
    'fin',
    '',
  ].join('\n');
  assert.equal(render(tpl, ctx), 'début\n- a\n- b\nfin\n');
});

test('les CRLF du gabarit sont normalisés', () => {
  assert.equal(render('a\r\n{{#if flag}}\r\nx\r\n{{/if}}\r\nb\r\n', ctx), 'a\nb\n');
});

test('gabarit mal formé : erreur explicite', () => {
  assert.throws(() => render('{{#if a}}x', ctx), /non fermé/);
  assert.throws(() => render('{{/if}}', ctx), /ne ferme pas/);
  assert.throws(() => render('{{#each list}}{{else}}{{/each}}', ctx), /else/);
});
