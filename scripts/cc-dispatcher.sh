#!/bin/bash
# cc-dispatcher.sh — Watches task queue and launches Claude Code sessions
# Atlas writes task files, this script picks them up and runs them

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${ATLAS_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
QUEUE_DIR="$PROJECT_ROOT/workspace/task-queue"
LOG_FILE="$PROJECT_ROOT/workspace/task-queue/dispatcher.log"
POLL_INTERVAL=30  # seconds between checks

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log "Dispatcher started. Watching $QUEUE_DIR for new tasks..."

while true; do
  # Look for pending task files (*.task.json)
  for task_file in "$QUEUE_DIR"/*.task.json; do
    [ -f "$task_file" ] || continue

    # Read task details
    task_id=$(basename "$task_file" .task.json)
    prompt=$(cat "$task_file" | python3 -c "import sys,json; print(json.load(sys.stdin)['prompt'])" 2>/dev/null)
    workdir=$(cat "$task_file" | python3 -c "import sys,json; print(json.load(sys.stdin).get('workdir','~'))" 2>/dev/null)

    if [ -z "$prompt" ]; then
      log "ERROR: Could not read prompt from $task_file"
      mv "$task_file" "$task_file.error"
      continue
    fi

    log "Picked up task: $task_id"
    log "Prompt: $prompt"
    log "Workdir: $workdir"

    # Mark as running
    mv "$task_file" "$QUEUE_DIR/$task_id.running.json"

    # Launch Claude Code session
    output_file="$QUEUE_DIR/$task_id.output.log"
    cd "$workdir" 2>/dev/null || cd ~

    log "Launching Claude Code session for task $task_id..."
    CC -p "$prompt" > "$output_file" 2>&1
    exit_code=$?

    # Mark as complete
    mv "$QUEUE_DIR/$task_id.running.json" "$QUEUE_DIR/$task_id.done.json"

    log "Task $task_id completed with exit code $exit_code"
    log "Output saved to $output_file"

    # Write completion marker
    python3 -c "
import json, datetime
with open('$QUEUE_DIR/$task_id.done.json','r') as f:
    task = json.load(f)
task['status'] = 'completed'
task['exit_code'] = $exit_code
task['completed_at'] = datetime.datetime.now().isoformat()
task['output_file'] = '$output_file'
with open('$QUEUE_DIR/$task_id.done.json','w') as f:
    json.dump(task, f, indent=2)
"
    log "Task $task_id marked as done"
  done

  sleep "$POLL_INTERVAL"
done
