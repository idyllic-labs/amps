# WeatherAssistant

A working example imps agent that provides weather and timezone information.

## Skills

- **weather** - Get current weather using wttr.in (no API key needed)
- **timezone** - Get timezone info and convert times

## Example Usage

Ask me:
- "What's the weather in London?"
- "What time is it in Tokyo?"
- "Convert 3 PM EST to Paris time"

## How I Work

I use the Agent Skills standard with:
1. skills/weather/SKILL.md - Instructions for getting weather
2. skills/timezone/SKILL.md - Instructions for timezone conversions

When you ask a question, I decide which skill to use based on the descriptions.
