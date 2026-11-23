import { access, readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

const roots = ['dist', '.vercel/output/static'];
const docsSource = resolve('src/content/docs/docs');
const shaderSource = resolve('../data/shaders');
// Text the unedited template ships with. Any of it in a built page means a
// config or docs file still has a placeholder in it. A fresh template has them
// on purpose, so they are reported as warnings; `--strict` makes them fail,
// for the point where a real project is about to ship.
const strict = process.argv.includes('--strict');
const placeholders = [/Your Project/, /YOUR_USERNAME/, /YOUR_PROJECT/, /your-project/];
const obsolete = ['blog', 'projects', 'services', 'about', 'contact'];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function files(directory, extension) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path, extension)));
    else if (entry.name.endsWith(extension)) found.push(path);
  }
  return found;
}

const root = (
  await Promise.all(roots.map(async (candidate) => ({ candidate, ok: await exists(resolve(candidate, 'index.html')) })))
).find((entry) => entry.ok)?.candidate;
if (!root) throw new Error('No built landing page found. Run pnpm build first.');

// Every page the site is supposed to have: the landing page plus one built page
// per Markdown/MDX file in the docs source. Deriving it from the source means a
// new doc is checked without anyone remembering to list it here.
const routes = ['index.html', 'gallery/index.html', '404.html'];
for (const file of await files(docsSource, '.md').then(async (md) => [...md, ...(await files(docsSource, '.mdx'))])) {
  const slug = relative(docsSource, file).replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '');
  routes.push(join('docs', slug, 'index.html'));
}

const problems = [];
const placeholderFindings = [];
for (const route of routes) {
  if (await exists(resolve(root, route))) console.log(`OK: /${route}`);
  else problems.push(`Missing route: ${root}/${route}`);
}

const gallery = await readFile(resolve(root, 'gallery/index.html'), 'utf8').catch(() => '');
const home = await readFile(resolve(root, 'index.html'), 'utf8');
const manifests = (await files(shaderSource, '.json')).filter((file) => basename(file) === 'manifest.json');
for (const file of manifests) {
  const { id } = JSON.parse(await readFile(file, 'utf8'));
  if (!gallery.includes(`id="${id}"`)) problems.push(`Missing gallery card: ${id}`);
  if (!(await exists(resolve(root, 'media/shaders', `${id}.webp`)))) {
    problems.push(`Missing shader still: ${id}`);
  }
}
for (const [, asset] of (home + gallery).matchAll(/(?:src|poster)="[^"]*\/(media\/[^"]+)"/g)) {
  if (!(await exists(resolve(root, asset)))) problems.push(`Missing media file: ${asset}`);
}

for (const name of obsolete) {
  if (await exists(resolve(root, name, 'index.html'))) problems.push(`Obsolete demo route still exists: ${name}/index.html`);
}

for (const page of await files(resolve(root), '.html')) {
  const html = await readFile(page, 'utf8');
  const found = placeholders.filter((pattern) => pattern.test(html)).map(String);
  if (found.length) placeholderFindings.push(`Template placeholder ${found.join(', ')} in ${relative(resolve(root), page)}`);
}

if (strict) problems.push(...placeholderFindings);
else if (placeholderFindings.length) {
  console.warn(placeholderFindings.map((finding) => `WARN: ${finding}`).join('\n'));
  console.warn('Placeholders are expected in a fresh template. Run `pnpm check:site --strict` to fail on them before launch.');
}

if (problems.length) {
  console.error(problems.map((problem) => `FAIL: ${problem}`).join('\n'));
  process.exit(1);
}
console.log(`Single-project routes verified${placeholderFindings.length ? '' : '; no template placeholders found'}.`);
