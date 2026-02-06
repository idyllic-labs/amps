# Heartbeat

## Schedule
@every: 15m

## On Wake
1. Check state/current-task.md for pending work
2. If task exists, resume from last checkpoint
3. If idle, check memory/goals.md for proactive tasks
4. Log wake event to logs/

## Routine Tasks
- Every morning at 09:00: Summarize yesterday's activity
- Every hour: Check monitored directories for changes
- Every evening at 18:00: Create daily summary

## Context Reconstruction
When waking up, load:
- state/current-task.md (immediate context)
- memory/patterns.md (learned behaviors)
- Last 5 entries from logs/ (recent history)
