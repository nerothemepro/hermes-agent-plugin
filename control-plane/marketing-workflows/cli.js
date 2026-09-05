'use strict';

const { MarketingWorkflowController } = require('./controller');
const { parseTelegramCommand } = require('./command-parser');
const { resolveEpisodeSeed } = require('./episode-seeds');

function requireText(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function assertRunId(inputRunId, commandRunId) {
  if (inputRunId && inputRunId !== commandRunId) throw new Error('run id conflicts with Telegram command');
  return commandRunId;
}

function assertWorkflow(controller, runId, workflow) {
  const state = controller.status(runId);
  if (state.workflow !== workflow) throw new Error('workflow does not match canonical run');
  return state;
}

function prepareInput(command, input) {
  if (command.workflow === 'research_and_story') {
    if (input !== undefined) throw new Error('research input is resolved only from the allowlisted episode seed');
    return resolveEpisodeSeed(command.episode_id);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('approved handoff input is required');
  if (command.workflow === 'video_production' && input.approval?.artifact_sha256 !== command.brief_sha256) {
    throw new Error('brief sha256 does not match approved handoff');
  }
  if (command.workflow === 'social_distribution') {
    if (input.brief?.approval?.artifact_sha256 !== command.brief_sha256 || input.video?.approval?.artifact_sha256 !== command.video_sha256) {
      throw new Error('social input hashes do not match approved handoffs');
    }
    return input;
  }
  return input;
}

function execute(input) {
  const command = parseTelegramCommand(requireText(input.text, 'Telegram text'));
  const controller = input.controller || new MarketingWorkflowController({ databaseFile: input.databaseFile, artifactRoot: input.artifactRoot });
  const closeController = !input.controller;
  try {
    if (command.action === 'prepare') {
      const runId = requireText(input.runId, 'run id');
      const result = controller.prepare({
        commandId: requireText(input.commandId, 'command id'),
        workflow: command.workflow,
        runId,
        input: prepareInput(command, input.handoff),
      });
      return result;
    }
    if (command.action === 'kickoff') {
      const runId = assertRunId(input.runId, command.run_id);
      assertWorkflow(controller, runId, command.workflow);
      return controller.approveKickoff({ commandId: requireText(input.commandId, 'command id'), runId, packetSha256: command.packet_sha256 });
    }
    if (command.action === 'approve_gate') {
      const runId = assertRunId(input.runId, command.run_id);
      assertWorkflow(controller, runId, command.workflow);
      return controller.approveGate({ commandId: requireText(input.commandId, 'command id'), runId, gateId: command.gate_id, packetSha256: command.packet_sha256 });
    }
    if (command.action === 'reject_gate') {
      const runId = assertRunId(input.runId, command.run_id);
      assertWorkflow(controller, runId, command.workflow);
      return controller.rejectGate({ commandId: requireText(input.commandId, 'command id'), runId, gateId: command.gate_id, reasonCode: command.reason_code });
    }
    if (command.action === 'cancel') {
      const runId = assertRunId(input.runId, command.run_id);
      assertWorkflow(controller, runId, command.workflow);
      return controller.cancel({ commandId: requireText(input.commandId, 'command id'), runId });
    }
    if (command.action === 'status') {
      const runId = assertRunId(input.runId, command.run_id);
      return assertWorkflow(controller, runId, command.workflow);
    }
    throw new Error('unsupported Telegram marketing action');
  } finally {
    if (closeController) controller.close();
  }
}

module.exports = { assertRunId, assertWorkflow, execute, prepareInput };
