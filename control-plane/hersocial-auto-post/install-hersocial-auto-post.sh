#!/usr/bin/env bash
set -euo pipefail

supervisor_config=/workspace/hermes-agent-plugin/control-plane/supervisord/supervisord.conf

install -d -m 700 /opt/data/hermes/control-plane/hersocial-auto-post
chmod 755 \
  /workspace/hermes-agent-plugin/control-plane/hersocial-auto-post/hersocial_auto_post_runner.py \
  /workspace/hermes-agent-plugin/control-plane/hersocial-auto-post/start-hersocial-auto-post.sh

supervisorctl -c "$supervisor_config" reread
supervisorctl -c "$supervisor_config" update
supervisorctl -c "$supervisor_config" status hermes-hersocial-auto-post
