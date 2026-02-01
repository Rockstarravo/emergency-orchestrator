# Emergency Orchestrator Agent 🚑🤖

A multimodal AI agent for emergency response coordination. It listens to live audio, analyzes incident context (including images), and coordinates with Hospital, Ambulance, and Guardian services.

## Features

-   **Real-time Voice Interface**: Uses OpenAI Realtime API for low-latency voice interaction.
-   **Multimodal Analysis**: Analyzes images uploaded during the emergency calls using GPT-4 Vision.
-   **Intelligent Coordination**: Decisions managed by a central "Coordinator" agent.
-   **Service Integration**: Connects with simulated Hospital, Ambulance, and Guardian services.
-   **Robust Audio Handling**: Features echo cancellation, silence detection, and noise filtering.

## Architecture

-   **Agent Daemon**: Watcher service that detects new incidents and triggers the agent.
-   **Realtime Gateway**: WebSocket server managing the audio stream with OpenAI.
-   **Coordinator**: The "Brain" that decides actions based on context.
-   **Runner**: Executes the Coordinator's decisions (dispatching services, logging events).

## Prerequisites

-   Node.js v18+
-   OpenAI API Key (with access to Realtime API `gpt-4o-realtime-preview`)

## Setup

1.  **Clone the repository**
    ```bash
    git clone <your-repo-url>
    cd emergency-orchestrator
    ```

2.  **Install dependencies**
    ```bash
    npm install
    # or
    bash start-all.sh --install
    ```

3.  **Environment Configuration**
    Create a `.env` file in the root directory:
    ```env
    OPENAI_API_KEY=sk-your-openai-key-here
    
    # Optional Overrides
    INCIDENT_BASE_URL=http://localhost:4001
    HOSPITAL_SERVICE_URL=http://localhost:4002
    AMBULANCE_SERVICE_URL=http://localhost:4003
    GUARDIAN_SERVICE_URL=http://localhost:4004
    ```

## Running the System

To start all services (Incident, Hospital, Ambulance, Guardian, Agent, UI):

```bash
bash start-all.sh
```

The services will be available at:
-   **Emergency UI**: http://localhost:3000
-   **Incident Service**: http://localhost:4001
-   **Hospital Service**: http://localhost:4002
-   **Ambulance Service**: http://localhost:4003

## Development

-   **Agent Logic**: `agent/coordinator.ts`
-   **Audio Gateway**: `agent/realtime-gateway.ts`
-   **Context Builder**: `agent/context.ts`

## License

MIT
