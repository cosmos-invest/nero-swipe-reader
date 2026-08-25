import fs from 'node:fs';

const id=String(process.env.NERO_KV_NAMESPACE_ID||'').trim();
if(!/^[a-f0-9]{32}$/i.test(id)){
  throw new Error('NERO_KV_NAMESPACE_ID must be the 32-character Workers KV namespace id');
}
const enabled=String(process.env.NERO_AUTO_ENABLED||'false').toLowerCase()==='true';
const config={
  $schema:'node_modules/wrangler/config-schema.json',
  name:'nero-engagement-worker',
  main:'automation/worker.js',
  compatibility_date:'2026-08-25',
  kv_namespaces:[{binding:'STATE',id}],
  triggers:{crons:['0 * * * *']},
  vars:{AUTO_ENABLED:String(enabled)},
  observability:{enabled:true,head_sampling_rate:0.05}
};
fs.writeFileSync('.wrangler.automation.generated.jsonc',JSON.stringify(config,null,2)+'\n');
console.log(`rendered nero-engagement-worker (AUTO_ENABLED=${enabled})`);
