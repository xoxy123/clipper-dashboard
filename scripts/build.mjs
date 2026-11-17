// GitHub Pages gets only browser assets. Fails if a secret-looking value slipped in.
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
const files = ['index.html', 'style.css', 'app.js', 'api.js', 'view.js', 'config.js', 'favicon.svg'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const f of files) {
  const text = await readFile('src/' + f, 'utf8');
  if (/service_role|x-admin-secret/i.test(text)) throw Error(`${f} contains a secret-looking value`);
  await copyFile('src/' + f, 'dist/' + f);
}
await writeFile('dist/.nojekyll', '');
console.log('Built dist/');
