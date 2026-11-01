import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
export default defineConfig([...next, globalIgnores(['.next/**','.superpowers/**','supabase/**','playwright-report/**','test-results/**','next-env.d.ts'])]);
