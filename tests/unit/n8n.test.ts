import {it,expect} from 'vitest';
import {buildN8nWorkflow} from '../../src/integrations/n8n';
import {config} from '../helpers/fixture';
it('generates an importable UTC workflow with a safe synthetic default',()=>{const flow=buildN8nWorkflow('monitor',config,'https://watchdog.example');expect(flow.settings).toMatchObject({timezone:'UTC'});expect(flow.active).toBe(false);expect(Array.isArray(flow.nodes)).toBe(true);});
