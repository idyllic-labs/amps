---
name: weather
description: Get current weather and forecasts for any location using wttr.in
---

# Weather Skill

Get current weather conditions and forecasts for any location.

## When to Use

Use this skill when the user asks about:
- Current weather conditions
- Weather forecasts
- Temperature, precipitation, wind
- Weather for specific cities or locations

## How It Works

This skill uses the wttr.in service to fetch weather data. wttr.in provides:
- Current conditions
- 3-day forecast
- ASCII art weather displays
- No API key required

## Usage Instructions

1. Extract the location from the user's request
2. Use the bash tool to call wttr.in
3. Parse and present the relevant information

## Examples

### Get current weather
```bash
curl "wttr.in/London?format=3"
# Returns: London: ☀️  +15°C
```

### Get detailed forecast
```bash
curl "wttr.in/Paris?0"
# Returns: Current conditions only
```

### Get 3-day forecast
```bash
curl "wttr.in/Tokyo"
# Returns: Full 3-day forecast with ASCII art
```

### Get specific format
```bash
curl "wttr.in/NYC?format=%C+%t+%w"
# Returns: Condition Temperature Wind
# Example: Clear +20°C 10km/h
```

## Format Options

- `?format=3` - One-line format: Location: Emoji Temperature
- `?format=%C` - Condition
- `format=%t` - Temperature
- `?format=%w` - Wind
- `?format=%h` - Humidity
- `?format=%p` - Precipitation
- `?0` - Current conditions only
- `?1` - Today + 1 day
- `?2` - Today + 2 days

## Response Format

Always format weather information clearly:

```
Weather for [Location]:
- Condition: [Clear/Cloudy/Rainy/etc]
- Temperature: [temp]
- Wind: [speed]
- Humidity: [percentage]
```

For forecasts, show day-by-day breakdown.

## Error Handling

If location is not found, suggest:
- Checking spelling
- Using city name only
- Using major city nearby
