'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const source = name => fs.readFileSync(path.join(root,name),'utf8');
const {entries} = vm.runInNewContext(source('sky-assets.js')+'\nAsteriaSkyAssets');
const manifest = JSON.parse(source('assets/v4/manifest.json'));

test('all 32 sectors have independent low and medium cube packs with exact manifest hashes', () => {
  assert.equal(Object.keys(manifest).length,32);
  const names = new Set();
  for (const record of Object.values(manifest)) {
    assert.equal(record.keyLight.length,3);
    assert.ok(record.faces.low && record.faces.medium);
    for (const asset of [...Object.values(record.faces),record.master,record.surface].filter(Boolean)) {
      assert.ok(!names.has(asset.path),asset.path);
      names.add(asset.path);
      const bytes = fs.readFileSync(path.join(root,asset.path));
      assert.equal(bytes.length,asset.bytes);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256);
      if (asset.path.endsWith('.cube')) {
        const unpacked = entries(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),bytes.length);
        assert.equal(unpacked.length,6);
      }
    }
  }
  assert.equal(names.size,81);
});

test('incomplete and forged cube packs are rejected', () => {
  const bad = new Uint8Array(28);
  assert.throws(() => entries(bad.buffer, bad.length));
  const image = manifest.nereid.faces.medium;
  const file = fs.readFileSync(path.join(root,image.path));
  const truncated = file.subarray(0,file.length-1);
  assert.throws(() => entries(truncated.buffer.slice(truncated.byteOffset,truncated.byteOffset+truncated.byteLength),image.bytes));
});
