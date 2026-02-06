---
schedule: 15m
---

# Heartbeat

## On Wake

When the heartbeat fires, the agent will:

1. Check state/current-task.md for pending work
2. If task exists, resume from last checkpoint
3. If idle, check memory/goals.md for proactive tasks
4. Log wake event to logs/

## Routine Tasks

- **Every morning at 09:00**: Summarize yesterday's activity
- **Every hour**: Check monitored directories for changes

## Context Reconstruction

When waking up, the agent should load:

- state/current-task.md (immediate context)
- memory/patterns.md (learned behaviors)
- Last 5 entries from logs/ (recent history)
