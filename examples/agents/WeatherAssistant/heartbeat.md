---
schedule: 30m
---

# Heartbeat

## On Wake

When the heartbeat fires, the agent will:

1. Check if there are any saved locations in memory/locations.md
2. Log wake event
3. Check for any pending weather requests

## Routine Tasks

- **Every morning at 07:00**: Check weather for saved locations
- **Every 3 hours**: Update forecast data for active locations

## Context Reconstruction

When waking up, the agent should load:

- memory/locations.md (user's saved locations)
- state/last-request.md (most recent weather request)
- Last wake event from logs/
