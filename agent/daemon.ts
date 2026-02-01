import WebSocket from 'ws';
import { config } from './config.js';
import { runAgentForIncident } from './runner.js';

interface WsEvent {
    event_type: string;
    incident_id: string;
    timestamp: string;
    payload: any;
}

/**
 * Auto-trigger daemon that watches for new incidents
 * and automatically runs the agent for emergency cases
 */
export class AgentDaemon {
    private activeIncidents = new Set<string>();
    private ws: WebSocket | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private debounceTimers = new Map<string, NodeJS.Timeout>();

    constructor() {
        this.connect();
    }

    private connect() {
        // Connect to incident service WebSocket (no specific incident - we'll subscribe to all)
        // Note: This requires a global WS endpoint or we poll the API
        // For now, we'll use polling approach
        this.startPolling();
    }

    /**
     * Poll for new incidents and auto-run agent
     */
    private async startPolling() {
        console.log('[daemon] Starting incident polling...');
        console.log('[daemon] Checking for new emergency incidents every 5s\n');

        const pollFn = async () => {
            try {
                const res = await fetch(`${config.incidentBaseUrl}/incidents`);
                if (!res.ok) return;

                const data = await res.json();
                if (!data.success || !Array.isArray(data.data)) return;

                const incidents: any[] = data.data;
                for (const incident of incidents) {
                    if (!this.activeIncidents.has(incident.id)) {
                        console.log(`[daemon] 🆕 Found new incident: ${incident.id}`);
                        await this.watchIncident(incident.id);

                        // Check if it's already an emergency at startup
                        if (this.isEmergency(incident)) {
                            // Let the handleEvent logic take care of it via incident_created
                            // Or if it's old, we might want to check urgency manually here
                            // For now, watching it subscribes to future events which is good
                        }
                    }
                }
            } catch (err: any) {
                console.error('[daemon] Polling error:', err?.message);
            }
        };

        // Initial poll
        pollFn();

        // Interval poll
        setInterval(pollFn, 5000);
    }

    /**
     * Subscribe to a specific incident and auto-run agent on events
     */
    async watchIncident(incidentId: string) {
        if (this.activeIncidents.has(incidentId)) {
            console.log(`[daemon] Already watching ${incidentId}`);
            return;
        }

        this.activeIncidents.add(incidentId);
        console.log(`[daemon] 👀 Watching incident: ${incidentId}`);

        const wsUrl = `ws://localhost:4001/ws?incident_id=${incidentId}`;
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
            console.log(`[daemon] ✓ Connected to ${incidentId}`);
        });

        ws.on('message', async (data: WebSocket.Data) => {
            try {
                const event: WsEvent = JSON.parse(data.toString());
                await this.handleEvent(incidentId, event);
            } catch (err: any) {
                console.error('[daemon] Message parse error:', err?.message);
            }
        });

        ws.on('error', (err) => {
            console.error(`[daemon] WebSocket error for ${incidentId}:`, err.message);
        });

        ws.on('close', () => {
            console.log(`[daemon] Disconnected from ${incidentId}`);
            this.activeIncidents.delete(incidentId);
        });
    }

    /**
     * Handle incoming WebSocket events
     */
    private async handleEvent(incidentId: string, event: WsEvent) {
        console.log(`[daemon] Event: ${event.event_type} for ${incidentId}`);

        // Auto-run agent on incident creation if it's an emergency
        if (event.event_type === 'incident_created') {
            const incident = event.payload?.incident;
            if (incident && this.isEmergency(incident)) {
                console.log(`[daemon] 🚨 Emergency detected! Auto-running agent...`);
                await runAgentForIncident(incidentId);
            }
        }

        // Auto-run on new captions (user speaking)
        if (event.event_type === 'timeline_event') {
            const timelineEvent = event.payload?.event;
            if (timelineEvent?.type === 'live_caption_final') {
                console.log(`[daemon] 💬 New caption detected, running agent...`);
                // Debounce: wait a bit for more captions
                if (this.debounceTimers.has(incidentId)) {
                    clearTimeout(this.debounceTimers.get(incidentId)!);
                }

                const timer = setTimeout(() => {
                    this.debounceTimers.delete(incidentId);
                    runAgentForIncident(incidentId);
                }, 2000);

                this.debounceTimers.set(incidentId, timer);
            }
        }

        // Auto-run on new attachments (images uploaded)
        if (event.event_type === 'timeline_event') {
            const timelineEvent = event.payload?.event;
            if (timelineEvent?.type === 'system_event' && timelineEvent?.payload?.kind === 'attachments_added') {
                console.log(`[daemon] 📷 New images detected, running agent...`);
                await runAgentForIncident(incidentId);
            }
        }

        // Manual trigger
        if (event.event_type === 'timeline_event') {
            const timelineEvent = event.payload?.event;
            if (timelineEvent?.type === 'run_agent') {
                console.log(`[daemon] 🎯 Manual trigger detected, running agent...`);
                await runAgentForIncident(incidentId);
            }
        }
    }

    /**
     * Check if incident is an emergency
     */
    private isEmergency(incident: any): boolean {
        const metadata = incident.metadata || {};

        // Check severity
        if (metadata.severity === 'high' || metadata.severity === 'critical') {
            return true;
        }

        // Check summary for emergency keywords
        const summary = (metadata.summary || '').toLowerCase();
        const emergencyKeywords = [
            'emergency', 'urgent', 'critical', 'bleeding', 'unconscious',
            'chest pain', 'breathing', 'fell', 'accident', 'injury'
        ];

        return emergencyKeywords.some(keyword => summary.includes(keyword));
    }

    /**
     * Stop watching all incidents
     */
    stop() {
        console.log('[daemon] Stopping daemon...');
        this.activeIncidents.clear();
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
    }
}

/**
 * Start daemon in watch mode for multiple incidents
 */
export async function startDaemon(incidentIds: string[]) {
    const daemon = new AgentDaemon();

    for (const id of incidentIds) {
        await daemon.watchIncident(id);
    }

    // Keep process alive
    process.on('SIGINT', () => {
        console.log('\n[daemon] Shutting down...');
        daemon.stop();
        process.exit(0);
    });

    console.log('\n[daemon] Daemon running. Press Ctrl+C to stop.\n');
}
