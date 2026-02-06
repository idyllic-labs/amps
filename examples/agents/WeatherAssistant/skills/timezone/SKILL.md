---
name: timezone
description: Get timezone information and convert times between timezones
---

# Timezone Skill

Get timezone information and convert times between different timezones.

## When to Use

Use this skill when the user asks about:
- What time is it in [location]
- Time zone for a city
- Converting time between locations
- UTC offsets

## How It Works

Use the `date` command with timezone support to get accurate time information.

## Usage Instructions

### Get current time in a timezone

```bash
TZ="America/New_York" date
# Returns: Mon Feb  3 14:30:00 EST 2026
```

### Common Timezones

- **US**: America/New_York, America/Chicago, America/Denver, America/Los_Angeles
- **Europe**: Europe/London, Europe/Paris, Europe/Berlin, Europe/Moscow
- **Asia**: Asia/Tokyo, Asia/Shanghai, Asia/Dubai, Asia/Kolkata
- **Australia**: Australia/Sydney, Australia/Melbourne

### Get UTC time

```bash
date -u
# Returns: Mon Feb  3 19:30:00 UTC 2026
```

### Format time nicely

```bash
TZ="Asia/Tokyo" date "+%Y-%m-%d %H:%M:%S %Z"
# Returns: 2026-02-04 04:30:00 JST
```

## Response Format

Format timezone information clearly:

```
Current time in [Location]:
- Local: [HH:MM AM/PM]
- Timezone: [TZ name]
- UTC Offset: [+/-HH:MM]
```

For conversions:
```
[Time] in [Location1] is [Time] in [Location2]
```

## Examples

**User: "What time is it in Tokyo?"**
```bash
TZ="Asia/Tokyo" date "+%I:%M %p"
```

**User: "Convert 3 PM EST to London time"**
1. Get current EST time
2. Calculate offset
3. Show London time

## Common Conversions

- EST to GMT: +5 hours
- PST to EST: +3 hours
- JST to UTC: -9 hours
