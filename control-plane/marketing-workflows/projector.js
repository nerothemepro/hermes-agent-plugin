'use strict';

const LANES = Object.freeze([
  ['research_and_story', 'Research and Story'],
  ['video_production', 'Video Production'],
  ['social_distribution', 'Social Distribution'],
]);
function projectedStatus(run) {
  if (!run) return 'NOT_STARTED';
  if (run.status === 'waiting_for_approval') return 'IN_REVIEW';
  if (run.status === 'completed') return 'DONE';
  if (['blocked', 'failed', 'cancelled'].includes(run.status)) return 'BLOCKED';
  if (run.status === 'prepared') return 'TODO';
  return 'IN_PROGRESS';
}
function projectWorkflowChain(runs) {
  const byWorkflow = new Map((runs || []).map((run) => [run.workflow, run]));
  return LANES.map(([workflow, lane]) => {
    const run = byWorkflow.get(workflow);
    return { lane, workflow, run_id: run?.run_id || null, revision: run?.revision || 0, status: projectedStatus(run), next_action: run?.waiting_gate ? `Approve ${run.waiting_gate}` : run ? 'Monitor workflow' : 'Start after upstream approval' };
  });
}
module.exports = { projectWorkflowChain, projectedStatus };
