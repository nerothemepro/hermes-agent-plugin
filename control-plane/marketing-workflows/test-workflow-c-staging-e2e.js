'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { MarketingWorkflowController } = require('./controller');
const { execute } = require('./staging-entrypoint');
const { main: finalize } = require('./social-finalizer-cli');
function input() {
  const briefSha = 'a'.repeat(64); const videoSha = 'b'.repeat(64);
  return {
    brief: { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'research_and_story', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'story_lock', status: 'approved', artifact_sha256: briefSha } },
    video: { schema_version: 'sdtk.marketing-handoff.v1', workflow: 'video_production', episode_id: 'EP4', revision: 'r1', validation_status: 'pass', approval: { gate: 'picture_lock', status: 'approved', artifact_sha256: videoSha }, inputs: [{ sha256: briefSha }] },
  };
}
function native() { const tasks = new Map(); let n = 0; return { tasks, run(argv) { const action=argv[4]; if(action==='create'){const id='t_social_'+String(++n).padStart(3,'0');tasks.set(id,{id,assignee:'hersocial',status:'blocked'});return {returncode:0,stdout:JSON.stringify({id,assignee:'hersocial',status:'blocked'}),stderr:''};} if(action==='unblock'){tasks.get(argv[5]).status='ready';return {returncode:0,stdout:'',stderr:''};} if(action==='dispatch'){const task=[...tasks.values()].find((item)=>item.status==='ready');task.status='running';return {returncode:0,stdout:JSON.stringify({spawned:[{task_id:task.id,assignee:'hersocial'}]}),stderr:''};} if(action==='show')return {returncode:0,stdout:JSON.stringify({task:tasks.get(argv[5])}),stderr:''};if(action==='complete'){tasks.get(argv[5]).status='done';return {returncode:0,stdout:'',stderr:''};}throw new Error('unexpected action '+action);} }; }
test('disposable Workflow C staging E2E reaches Social Ready with no publisher path', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-c-staging-')); const runId='run_e2e_social_001'; const databaseFile=path.join(root,'state.sqlite'); const controller=new MarketingWorkflowController({databaseFile,artifactRoot:root}); const client=native(); const before=process.env.SDTK_MARKETING_WORKFLOW_MODE; process.env.SDTK_MARKETING_WORKFLOW_MODE='staging';
  try {
    const prepared=controller.prepare({commandId:'c:prepare',workflow:'social_distribution',runId,input:input()}); controller.approveKickoff({commandId:'c:kickoff',runId,packetSha256:prepared.kickoff_packet_sha256});
    const common={databaseFile,artifactRoot:root,runId}; const dispatched=execute({command:'dispatch',...common},{controller,client}); assert.strictEqual(dispatched.board,'marketing-social-staging'); assert.strictEqual(client.tasks.get(dispatched.native_task_id).assignee,'hersocial');
    const runRoot=path.join(root,runId); for(const platform of ['youtube','facebook','x']) fs.writeFileSync(path.join(runRoot,platform+'.json'),JSON.stringify({schema_version:'sdtk.marketing-social-payload.v1',platform,validation_status:'pass',publish_authorized:false,brief_approval_sha256:input().brief.approval.artifact_sha256,video_approval_sha256:input().video.approval.artifact_sha256})+'\n'); finalize(['--root',runRoot,'--run-id',runId,'--attempt','1']); client.tasks.get(dispatched.native_task_id).status='done';
    const submitted=execute({command:'submit',...common,taskId:'prepare_social',nativeTaskId:dispatched.native_task_id,candidateFile:path.join(runRoot,'worker-result.json')},{controller,client}); assert.strictEqual(submitted.state.waiting_gate,'social_ready'); const pkg=JSON.parse(fs.readFileSync(path.join(runRoot,'social-payload-package.json'),'utf8')); assert.strictEqual(pkg.publish_authorized,false); assert.ok(!fs.readdirSync(runRoot).some((name)=>/receipt|permalink|publish/i.test(name)));
    const complete=execute({command:'approve-gate',...common,gateId:'social_ready',packetSha256:submitted.packet_sha256,commandId:'c:social-ready'},{controller,client}); assert.strictEqual(complete.state.status,'completed');
  } finally { if(before===undefined) delete process.env.SDTK_MARKETING_WORKFLOW_MODE; else process.env.SDTK_MARKETING_WORKFLOW_MODE=before; controller.close(); fs.rmSync(root,{recursive:true,force:true}); }
});
