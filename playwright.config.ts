import {defineConfig} from '@playwright/test';
import {config} from 'dotenv';
config({path:'.env.local',quiet:true});
export default defineConfig({testDir:'tests/e2e',fullyParallel:false,workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:3100',trace:'retain-on-failure'},webServer:{command:'pnpm dev',url:'http://127.0.0.1:3100',reuseExistingServer:true,timeout:60000}});
