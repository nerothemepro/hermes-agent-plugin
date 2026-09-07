'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { parseArgs } = require('./handoff-materializer-cli');
test('handoff materializer CLI accepts only exact absolute arguments', () => {
  assert.deepStrictEqual(parseArgs(['--database-file','/tmp/state.sqlite','--artifact-root','/tmp/artifacts','--run-id','run_handoff_001']), { databaseFile:'/tmp/state.sqlite', artifactRoot:'/tmp/artifacts', runId:'run_handoff_001' });
  assert.throws(() => parseArgs(['--database-file','state.sqlite','--artifact-root','/tmp/artifacts','--run-id','run_handoff_001']), /invalid handoff materializer arguments/);
});
test('legacy completed Story Lock run can materialize its missing handoff idempotently', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marketing-handoff-cli-')); const runId='run_handoff_002'; const controller=new MarketingWorkflowController({databaseFile:path.join(root,'state.sqlite'),artifactRoot:path.join(root,'artifacts')});
  try {
    const prepared=controller.prepare({commandId:'handoff:prepare',workflow:'research_and_story',runId,input:{episode_id:'EP4',revision:'r1'}}); controller.approveKickoff({commandId:'handoff:kickoff',runId,packetSha256:prepared.kickoff_packet_sha256}); controller.startTask({runId,taskId:'research_story',workerId:'test'});
    const dir=path.join(root,'artifacts',runId); fs.mkdirSync(dir,{recursive:true}); const brief=Buffer.from(JSON.stringify({schema_version:'sdtk.marketing-production-brief.v1',episode_id:'EP4',revision:'r1',audience:'founders',pain_point:'lost context',hook:'Keep the story',narration:'Narration',cta:'https://sdtk.dev/',shot_list:[{id:'s1'}],claim_ledger:[{claim:'proof'}],evidence:['seed']})+'\n'); const crypto=require('crypto'); fs.writeFileSync(path.join(dir,'production-brief.json'),brief); const candidate={schema_version:'sdtk.video-task-result.v1',run_id:runId,task_id:'research_story',attempt:1,status:'completed',artifacts:[{path:'production-brief.json',sha256:crypto.createHash('sha256').update(brief).digest('hex'),media_type:'application/json'}],validation:{status:'pass',validator:'test',evidence:[]},summary:'done',error:null}; const waiting=controller.completeTask({runId,candidate}); controller.approveGate({runId,gateId:'story_lock',packetSha256:waiting.packet_sha256});
    fs.rmSync(path.join(root,'artifacts','handoffs'),{recursive:true,force:true});
    const first=controller.materializeHandoff(runId); const second=controller.materializeHandoff(runId); assert.strictEqual(first.wrote,true); assert.strictEqual(second.wrote,false); assert.ok(fs.existsSync(first.path));
  } finally {controller.close();fs.rmSync(root,{recursive:true,force:true});}
});
