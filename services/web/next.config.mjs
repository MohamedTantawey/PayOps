import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  reactStrictMode: true,
  experimental: { cpus: 1 },
  outputFileTracingRoot: root,
};