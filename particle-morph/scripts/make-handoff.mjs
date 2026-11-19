// Builds the handoff package for the site developer from the current source:
//   handoff-dist/particle-morph-handoff/      (folder)
//   handoff-dist/particle-morph-handoff.zip   (same, zipped)
// Usage: npm run handoff
import { cpSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'handoff-dist');
const pkg = join(outDir, 'particle-morph-handoff');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(pkg, { recursive: true });

cpSync(join(root, 'src/particle-morph'), join(pkg, 'particle-morph'), { recursive: true });
copyFileSync(join(root, 'handoff/component-CLAUDE.md'), join(pkg, 'particle-morph/CLAUDE.md'));
cpSync(join(root, 'public/models'), join(pkg, 'models'), { recursive: true });
cpSync(join(root, 'handoff/examples'), join(pkg, 'examples'), { recursive: true });
for (const f of ['README.md', 'INTEGRATION.md', 'CLAUDE_CODE_PROMPT.md']) copyFileSync(join(root, 'handoff', f), join(pkg, f));
copyFileSync(join(root, 'README.md'), join(pkg, 'TECHNICAL.md'));

execFileSync('zip', ['-r', '-q', '-X', 'particle-morph-handoff.zip', 'particle-morph-handoff'], { cwd: outDir });
console.log(`handoff package: ${pkg}\nzip: ${join(outDir, 'particle-morph-handoff.zip')}`);
