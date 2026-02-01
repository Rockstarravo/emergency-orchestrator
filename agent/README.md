## Coordinator Agent

Agent layer that watches incidents, analyzes attachments/audio with OpenAI multimodal models, and writes outcomes back to the Incident Service so UIs update via WebSocket.

### Run
- Install deps: `npm install --prefix agent`
- Execute once: `node agent/run-worker.js --incident_id=INC123 --once`
- Watch mode (default 2s poll): `node agent/run-worker.js --incident_id=INC123 --watch=true --interval=2000`

### Env
- `OPENAI_API_KEY` (required)
- `INCIDENT_BASE_URL` (default `http://localhost:4001`)
- `MODEL_TEXT` (default `gpt-4.1`)
- `MODEL_VISION` (default `gpt-4.1`)

### Notes
- Triggers on timeline events with `kind` of `attachments_added`, `audio_uploaded`, or `run_agent`.
- Actions are applied via `appendEvent`, `setState`, and `sendConsoleMessage`; guardian messages are blocked unless metadata explicitly allows.
- Logs basic run status and applied actions.
