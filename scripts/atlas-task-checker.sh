#!/bin/bash
# atlas-task-checker.sh — Scan Google Tasks for @Atlas mentions
# Only launches a CC session if it finds something. No tokens wasted on empty checks.

QUEUE_DIR="/Users/ghost/Projects/cc-wag/workspace/task-queue"
LOG_FILE="/Users/ghost/Projects/cc-wag/workspace/task-queue/atlas-tasks.log"
ATLAS_LIST="eENTTTdlNnA0djdpcnpqWQ"

# All task lists to scan for @Atlas mentions
SCAN_LISTS="MTIwMzc4MjQwMDI1MzQwMjI5Nzg6NTg5MDc0NzIxOjA c0pZNVJxdHhzd1ZvMkhPZQ MTIwMzc4MjQwMDI1MzQwMjI5Nzg6NTE5NzcxODIzOjA MTIwMzc4MjQwMDI1MzQwMjI5Nzg6MDow eENTTTdlNnA0djdpcnpqWQ"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log "Atlas task checker running..."

found_tasks=0

for list_id in $SCAN_LISTS; do
  # Get open tasks
  tasks=$(gws tasks tasks list --params "{\"tasklist\":\"$list_id\",\"showCompleted\":false}" 2>/dev/null)

  # Find tasks with @Atlas or in Atlas list
  echo "$tasks" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for task in data.get('items', []):
        title = task.get('title', '')
        notes = task.get('notes', '')
        task_id = task.get('id', '')
        # Check for @Atlas mention or if this is the Atlas list
        if '@atlas' in title.lower() or '@atlas' in notes.lower() or '$list_id' == '$ATLAS_LIST':
            if task.get('status') != 'completed':
                print(f'{task_id}|||{title}|||{notes}|||$list_id')
except:
    pass
" 2>/dev/null | while IFS='|||' read -r task_id title notes src_list; do
    [ -z "$task_id" ] && continue

    log "Found Atlas task: $title"
    found_tasks=1

    # Build prompt for CC
    instruction="$title"
    [ -n "$notes" ] && instruction="$title - Details: $notes"

    # Queue it for the CC dispatcher
    queue_id="atlas_$(date +%s)_$(openssl rand -hex 4)"
    python3 -c "
import json
task = {
    'id': '$queue_id',
    'prompt': '''Execute this instruction from Frank via Google Tasks: $instruction''',
    'workdir': '/Users/ghost/Projects/cc-wag',
    'status': 'pending',
    'source': 'google-tasks',
    'source_task_id': '$task_id',
    'source_list_id': '$src_list',
    'created_at': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
}
with open('$QUEUE_DIR/$queue_id.task.json', 'w') as f:
    json.dump(task, f, indent=2)
"

    # Mark original task as completed
    gws tasks tasks patch --params "{\"tasklist\":\"$src_list\",\"task\":\"$task_id\"}" --json '{"status":"completed"}' > /dev/null 2>/dev/null

    log "Queued as $queue_id, original task marked done"
  done
done

log "Check complete"
