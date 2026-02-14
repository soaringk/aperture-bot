# aperture-bot

LifeOS Personal Agent — a proactive assistant that operates through Slack.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your Slack tokens and LLM API keys

# Initialize a user data directory
npx tsx src/index.ts init

# Start the bot
npx tsx src/index.ts serve
```

## Commands

```
aperture-bot init [userId]   Initialize user data directory
aperture-bot serve           Start the bot server
aperture-bot status          Show current status
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | Slack app-level token (`xapp-...`) |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key |
| `OPENAI_API_KEY` | Yes* | OpenAI API key |
| `DATA_DIR` | No | Data directory (default: `./data`) |
| `LOG_LEVEL` | No | Log level (default: `info`) |

*At least one LLM API key is required.

### Slack App Setup

1. Create a Slack app at https://api.slack.com/apps
2. Enable **Socket Mode** (requires app-level token)
3. Subscribe to bot events: `message.channels`, `message.im`, `app_mention`
4. Add bot scopes: `chat:write`, `files:write`, `im:history`, `channels:history`
5. Install to workspace

### User Data

Each user's data lives in `DATA_DIR/users/{userId}/`:

- `SOUL.md` — Agent personality and LLM config (YAML frontmatter + Markdown)
- `HEARTBEAT.md` — Proactive schedule definitions
- `MEMORY.md` — Long-term memory (agent-maintained)
- `sessions/` — Per-session conversation context
- `history/` — Daily JSONL audit trail

## Architecture

Built on [`@mariozechner/pi-agent-core`](https://github.com/badlogic/pi-mono) for the agent runtime and [`@mariozechner/pi-ai`](https://github.com/badlogic/pi-mono) for multi-provider LLM access.

```
Channel Adapters (Slack) → Agent Hub → pi-agent-core Agent → pi-ai LLM
                                ↕
                          Storage Layer (JSONL)
```
