#!/bin/bash
# dispatch-task.sh — Queue a task for the CC dispatcher
# Usage: dispatch-task.sh "prompt text" [workdir]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${ATLAS_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
QUEUE_DIR="$PROJECT_ROOT/workspace/task-queue"
TASK_ID="task_$(date +%s)_$(openssl rand -hex 4)"
PROMPT="$1"
WORKDIR="${2:-$HOME}"

if [ -z "$PROMPT" ]; then
  echo "Usage: dispatch-task.sh \"prompt\" [workdir]"
  exit 1
fi

python3 -c "
import json
task = {
    'id': '$TASK_ID',
    'prompt': '''$PROMPT''',
    'workdir': '$WORKDIR',
    'status': 'pending',
    'created_at': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
}
with open('$QUEUE_DIR/$TASK_ID.task.json', 'w') as f:
    json.dump(task, f, indent=2)
print(f'Task queued: $TASK_ID')
"
