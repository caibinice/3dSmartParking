import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const source = await readFile('src/app/core/campus-layout.json', 'utf8');
const target = resolve('../enterprise-ai-cockpit/backend/src/main/resources/parking/campus-layout.json');
if (process.argv.includes('--write')) await writeFile(target, source);
else assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), JSON.parse(source), 'Front-end and AI navigation layouts differ; run with --write after reviewing the shared layout');
console.log('Campus layout contract matches the cockpit resource.');
