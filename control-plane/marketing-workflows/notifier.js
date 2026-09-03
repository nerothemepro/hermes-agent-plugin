'use strict';

const LABELS = Object.freeze({ research_and_story: 'Research and Story', video_production: 'Video Production', social_distribution: 'Social Distribution' });

function formatNotification(event) {
  const workflow = event.payload?.workflow;
  const label = LABELS[workflow] || event.run_id;
  const action = ({ run_prepared: 'prepared', task_started: 'started', task_completed: 'completed', task_failed: 'blocked', gate_waiting: 'waiting for owner approval', gate_approved: 'approved', run_cancelled: 'cancelled', run_completed: 'completed' })[event.event_type] || event.event_type;
  return `${label} ${action}\nrun_id: ${event.run_id}\nrevision: ${event.sequence}`;
}

async function drainNotifications(kernel, send) {
  let delivered = 0;
  for (const event of kernel.pendingOutbox()) {
    await send(formatNotification(event));
    if (kernel.markOutboxDelivered(event.id)) delivered += 1;
  }
  return delivered;
}

module.exports = { drainNotifications, formatNotification };
