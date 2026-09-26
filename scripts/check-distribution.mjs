import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipped = new Set(['.git', 'node_modules', '.wrangler', '.verification', '.build', '.swiftpm', 'DerivedData', 'dist', 'coverage']);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipped.has(name)) continue;
    const path = resolve(dir, name);
    if (lstatSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
}
walk(root);
const errors = [];
for (const path of files) {
  const name = relative(root, path);
  // Local operator configuration is intentionally ignored by this distribution check.
  if (/^(wrangler\.(toml|jsonc)|\.dev\.vars(?:\..*)?|\.env(?:\..*)?)$/.test(name)) continue;
  const content = readFileSync(path, 'utf8');
  if (/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    errors.push(`${name}: possible credential material`);
  }
  if (name.endsWith('.md')) {
    for (const match of content.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
      if (!existsSync(resolve(dirname(path), decodeURIComponent(link)))) errors.push(`${name}: missing link ${link}`);
    }
  }
  if (name.startsWith('.github/workflows/') || /^ci\/.*\.ya?ml$/.test(name)) {
    const jobs = content.replaceAll('wrangler deploy --dry-run --config wrangler.test.toml', 'local-bundle-check');
    if (/wrangler (?:deploy|secret)|npm run deploy|self-hosted|runs-on:\s*xcode-27/.test(jobs)) errors.push(`${name}: deployment or personal runner connection`);
  }
  if (/^(src|scripts|apps|test|integrations)\//.test(name) && name !== 'scripts/check-distribution.mjs') {
    if (/second-brain\.trofiealpesto\.workers\.dev|192\.168\.10\.|100\.70\.94\.59|dev\.trofiealpesto|\/Users\/giuva|trofiealpesto\/second-brain-wiki/.test(content)) {
      errors.push(`${name}: personal operational reference`);
    }
  }
}
const config = readFileSync(resolve(root, 'wrangler.toml.example'), 'utf8');
for (const key of ['WIKI_REPO_OWNER', 'WIKI_REPO_NAME', 'WIKI_BRANCH', 'ALLOWED_GITHUB_LOGINS']) {
  if (!config.includes(key)) errors.push(`example config missing ${key}`);
}
if (!config.includes('*/5 * * * *')) errors.push('Siri projection retry schedule missing');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`PASS: ${files.length} distribution files; local doc links, example config, credential patterns and operational references checked.`);
