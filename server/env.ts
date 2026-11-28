// Loads server/.env (local development) before anything reads process.env. Imported first by index.ts.
// In production there's no file: the host sets the variables (AWS secrets).
import { fileURLToPath } from 'node:url'

try {
  process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)))
} catch {
  /* no .env: fine */
}
