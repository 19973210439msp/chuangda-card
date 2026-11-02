const test = require('node:test');
const assert = require('node:assert/strict');
const { BUILT_IN_TEMPLATES, allTemplates } = require('../lib/templates');

test('only the ChuangDa template remains available for new cards', () => {
  assert.deepEqual(BUILT_IN_TEMPLATES.map((item) => item.id), ['classic']);
  assert.deepEqual(allTemplates({ cardTemplates: [] }).map((item) => item.id), ['classic']);
});
