// 静态校验：src 下所有相对 require 都能解析（写文件避免 shell 转义问题）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const seen = new Set();
let bad = 0;

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!fs.existsSync(file)) {
    console.error('MISSING', file);
    bad += 1;
    return;
  }
  const src = fs.readFileSync(file, 'utf8');
  const re = /require\(['"]([^'"]+)['"]\)/g;
  let m;
  while ((m = re.exec(src))) {
    if (!m[1].startsWith('.')) continue;
    const base = path.resolve(path.dirname(file), m[1]);
    const hit = [base, base + '.js', path.join(base, 'index.js')].find((c) => {
      try {
        return fs.statSync(c).isFile();
      } catch {
        return false;
      }
    });
    if (!hit) {
      console.error('BAD REQUIRE', file, '->', m[1]);
      bad += 1;
    } else {
      walk(hit);
    }
  }
}

function walkTree(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walkTree(p);
    else if (f.endsWith('.js')) walk(p);
  }
}

walkTree(root);
console.log(bad === 0 ? `require OK, ${seen.size} files` : `require FAIL: ${bad} bad`);
process.exitCode = bad > 0 ? 1 : 0;
