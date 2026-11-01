import type { MonitorConfig } from "../domain/types";
export type N8nNode = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: number[];
  parameters: Record<string, unknown>;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  credentials?: Record<string, { id: string; name: string }>;
};
export function buildN8nWorkflow(
  id: string,
  config: MonitorConfig,
  baseUrl: string,
) {
  const s = config.schedule;
  const cron =
    s.kind === "hourly"
      ? `0 ${s.minute} * * * *`
      : `0 ${s.minute} ${s.hour} * * ${s.kind === "weekdays" ? "1-5" : "*"}`;
  const capture = `const source = $input.first().json.timestamp; const triggerTime = source ? new Date(String(source)) : new Date(); const d = new Date(triggerTime); d.setUTCSeconds(0,0); ${s.kind === "hourly" ? `d.setUTCMinutes(${s.minute}); if(d>triggerTime)d.setUTCHours(d.getUTCHours()-1);` : `d.setUTCHours(${s.hour},${s.minute},0,0); if(d>triggerTime)d.setUTCDate(d.getUTCDate()-1); ${s.kind === "weekdays" ? "while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()-1);" : ""}`} return [{json:{event_id:'n8n-'+$execution.id,scheduled_for:d.toISOString(),config_version:${config.version},is_test:true}}];`;
  const report = `const meta = $('Capture run').first().json; const records = $input.first().json.records; if(!Array.isArray(records))throw new Error('Business action must return a records array, including [] for zero results'); const fields={}; for(const key of ${JSON.stringify(config.requiredFields)}) fields[key]=records.length>0 && records.every(r=>r && typeof r==='object' && Object.hasOwn(r,key) && r[key]!==undefined && r[key]!==null && String(r[key]).trim()!=='') ? true : null; return [{json:{...meta,record_count:records.length,fields}}];`;
  const nodes: N8nNode[] = [
    {
      id: "schedule",
      name: "UTC Schedule",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
      parameters: {
        rule: { interval: [{ field: "cronExpression", expression: cron }] },
      },
    },
    {
      id: "capture",
      name: "Capture run",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [240, 0],
      parameters: { jsCode: capture },
    },
    {
      id: "business",
      name: "Business action",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [480, 0],
      parameters: {
        jsCode:
          "// Replace with your business action. Keep one envelope even when records is empty.\nconst records = [];\nreturn [{json:{records}}];",
      },
    },
    {
      id: "report",
      name: "Build outcome",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [720, 0],
      parameters: { jsCode: report },
    },
    {
      id: "send",
      name: "Report to Watchdog",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [960, 0],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 1000,
      parameters: {
        method: "POST",
        url: baseUrl + "/api/ingest/" + id,
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json) }}",
        options: { timeout: 10000 },
      },
    },
  ];
  return {
    name: "Watchdog — " + id,
    active: false,
    settings: { timezone: "UTC", executionOrder: "v1" },
    nodes,
    connections: {
      "UTC Schedule": {
        main: [[{ node: "Capture run", type: "main", index: 0 }]],
      },
      "Capture run": {
        main: [[{ node: "Business action", type: "main", index: 0 }]],
      },
      "Business action": {
        main: [[{ node: "Build outcome", type: "main", index: 0 }]],
      },
      "Build outcome": {
        main: [[{ node: "Report to Watchdog", type: "main", index: 0 }]],
      },
    },
  };
}
