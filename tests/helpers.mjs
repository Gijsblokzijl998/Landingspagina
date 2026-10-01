// Gedeelde paden voor de tests.
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

export const INDEX_URL = new URL('../index.html', import.meta.url).href;
export const WORKER_PATH = new URL('../worker/src/index.js', import.meta.url).href;
export const FIX = fileURLToPath(new URL('./fixtures', import.meta.url));
export const OUT = fileURLToPath(new URL('./output', import.meta.url)); // schermafbeeldingen en tijdelijke bestanden

mkdirSync(OUT, { recursive: true });
