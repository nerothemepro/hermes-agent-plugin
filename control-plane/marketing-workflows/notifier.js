'use strict';

const LABELS = Object.freeze({ research_and_story: 'Research and Story', video_production: 'Video Production', social_distribution: 'Social Distribution' });
const APPROVALS = Object.freeze({ story_lock: 'STORY LOCK', asset_lock: 'ASSET LOCK', picture_lock: 'PICTURE LOCK', social_ready: 'SOCIAL READY' });

function formatNotification(event, workflow) {
  const resolvedWorkflow = workflow || event.payload?.workflow;
  const label = LABELS[resolvedWorkflow] || event.run_id;
  if (event.event_type === 'gate_waiting') {
    const approval = APPROVALS[event.payload?.gate_id];
    const packet = event.payload?.packet_sha256;
    if (approval && typeof packet === 'string' && /^[a-f0-9]{64}$/.test(packet)) {
      return `${label} waiting for owner approval\nrun_id: ${event.run_id}\nAPPROVE ${approval} ${event.run_id} ${packet}`;
    }
  }
  const action = ({
    run_prepared: 'prepared', kickoff_waiting: 'waiting for kickoff approval', kickoff_approved: 'kickoff approved',
    task_external_registered: 'native task registered', task_external_released: 'worker dispatched', task_started: 'started',
    task_completed: 'completed', task_failed: 'blocked', gate_waiting: 'waiting for owner approval',
    gate_approved: 'approved', run_cancelled: 'cancelled', run_completed: 'completed',
  })[event.event_type] || event.event_type;
  return `${label} ${action}\nrun_id: ${event.run_id}\nrevision: ${event.sequence}`;
}

async function drainNotifications(kernel, send) {
  let delivered = 0;
  for (const event of kernel.pendingOutbox()) {
    const workflow = kernel.currentState(event.run_id).workflow;
    await send(formatNotification(event, workflow));
    if (kernel.markOutboxDelivered(event.id)) delivered += 1;
  }
  return delivered;
}

function baselineNotifications(kernel) {
  let delivered = 0;
  for (const event of kernel.pendingOutbox()) if (kernel.markOutboxDelivered(event.id)) delivered += 1;
  return delivered;
}

module.exports = { baselineNotifications, drainNotifications, formatNotification };
