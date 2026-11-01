import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
config({path: '.env.local', quiet:true});
export default defineConfig({test:{testTimeout:15000, hookTimeout:30000, fileParallelism:false}});
