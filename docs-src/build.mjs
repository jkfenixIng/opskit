#!/usr/bin/env node
/*
 * OpsKit — document build.
 *
 * Renders each source HTML into its PDF with headless Chrome, one A4 sheet per
 * `.page` element. No npm dependencies: it only needs a Chrome or Edge binary.
 *
 * The sources live in `docs-src/`; the rendered documents live in
 * `opskit-documentos/`, which must stay clean: PDFs only.
 *
 *   node docs-src/build.mjs                              # all documents
 *   node docs-src/build.mjs --only 01-modulos-y-logica.html
 *   node docs-src/build.mjs page.html out.pdf            # ad hoc
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(sourceDir, '..', 'opskit-documentos');

const documents = [
  { source: '01-modulos-y-logica.html', output: '01_OpsKit_Modulos_y_Logica.pdf' },
  { source: '02-flujos-operativos.html', output: '02_OpsKit_Flujos_Operativos.pdf' },
  { source: '03-arquitectura-y-portabilidad.html', output: '03_OpsKit_Arquitectura_y_Portabilidad.pdf' },
];

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
    process.env.HOME && join(process.env.HOME, '.cache', 'ms-playwright'),
  ].filter(Boolean);

  const relative = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  ];

  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith('chromium')) continue;
      for (const [folder, binary] of relative) {
        const candidate = join(cache, entry, folder, binary);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  throw new Error('No Chrome or Edge binary found. Set CHROME_PATH to one.');
}

function countPages(pdfPath) {
  const bytes = readFileSync(pdfPath).toString('latin1');
  return (bytes.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

function render(chrome, htmlPath, pdfPath) {
  mkdirSync(dirname(pdfPath), { recursive: true });
  const result = spawnSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--no-pdf-header-footer',
      '--virtual-time-budget=5000',
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  );

  if (!existsSync(pdfPath) || statSync(pdfPath).size === 0) {
    throw new Error(
      `Chrome produced no PDF for ${htmlPath}\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  return { pages: countPages(pdfPath), bytes: statSync(pdfPath).size };
}

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const positional = args.filter((arg, index) => {
  if (arg.startsWith('--')) return false;
  if (onlyIndex >= 0 && index === onlyIndex + 1) return false;
  return true;
});

const chrome = findChrome();
console.log(`chrome: ${chrome}`);

const queue =
  positional.length === 2
    ? [{ source: positional[0], output: positional[1] }]
    : documents.filter((document) => !only || document.source === only);

if (queue.length === 0) {
  throw new Error(`No document matched ${only ?? '(no filter)'}`);
}

let failed = false;
for (const document of queue) {
  const htmlPath = join(sourceDir, document.source);
  const pdfPath = resolve(outputDir, document.output);
  if (!existsSync(htmlPath)) {
    console.error(`missing source: ${document.source}`);
    failed = true;
    continue;
  }
  const { pages, bytes } = render(chrome, htmlPath, pdfPath);
  const sheets = (readFileSync(htmlPath, 'utf8').match(/class="page"/g) ?? []).length;
  const verdict = pages === sheets ? 'ok' : `MISMATCH (${sheets} .page elements)`;
  console.log(`${document.output}: ${pages} pages, ${(bytes / 1024).toFixed(0)} KiB — ${verdict}`);
  if (pages !== sheets) failed = true;
}

process.exit(failed ? 1 : 0);
