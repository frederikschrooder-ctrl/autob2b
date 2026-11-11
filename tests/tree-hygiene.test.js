'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function containsSecret(text, secret) {
  if (!secret) return false;
  if (secret.length >= 10) return text.includes(secret);
  return text.includes("'" + secret + "'") || text.includes('"' + secret + '"');
}

test('working tree has no previous admin secrets, database, or login sheets', () => {
  const old = execFileSync('git', ['show', '431e4354233cf8210fbb3f0734b10c7c1f08ac41:src/ensure-admins.js'], { cwd: root, encoding: 'utf8' });
  const secrets = [...old.matchAll(/password:\s*'([^']*)'/g)].map((m) => m[1]);
  const emails = [...old.matchAll(/email:\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(secrets.length >= 1);
  assert.ok(emails.length >= 1);
  const files = walk(root);
  for (const file of files) {
    if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.webp')) continue;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const secret of secrets) {
      assert.equal(containsSecret(text, secret), false, 'credential material remains in ' + path.relative(root, file));
    }
    for (const email of emails) {
      assert.equal(text.includes(email), false, 'previous admin email remains in ' + path.relative(root, file));
    }
  }
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const file of tracked) {
    assert.equal(/\.sqlite($|-)/.test(file), false, file);
    assert.equal(file.includes('ensure-admins'), false, file);
    assert.equal(/(^|\/)ADMIN_LOGIN\.txt$/.test(file), false, file);
    assert.equal(/(^|\/)LOGIN-INFO\.txt$/.test(file), false, file);
    assert.equal(/(^|\/)secrets\.env$/.test(file), false, file);
  }
  assert.equal(tracked.includes('render.yaml'), false);
  assert.equal(fs.existsSync(path.join(root, 'render.yaml')), false);
  assert.equal(fs.existsSync(path.join(root, 'src', 'ensure-admins.js')), false);
  const start = fs.readFileSync(path.join(root, 'start.sh'), 'utf8');
  assert.equal(start.includes('seed.js'), false);
});

test('seed command exits without writing a database', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'autob2b-seed-'));
  let code = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'seed.js'), '--samples'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    code = e.status;
    stderr = e.stderr || '';
  }
  assert.equal(code, 1);
  assert.match(stderr, /does not seed data/);
  assert.equal(fs.existsSync(path.join(dir, 'data', 'autob2b.sqlite')), false);
  assert.equal(stderr.includes('password:'), false);
});
