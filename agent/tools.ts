import { config } from './config';

export interface Incident {
    id: string;
    state: string;
    created_at: string;
    updated_at: string;
    metadata: Record<string, unknown>;
    timeline: TimelineEvent[];
}

export interface TimelineEvent {
    ts: string;
    actor: string;
    type: string;
    payload: Record<string, unknown>;
}

export interface ConsoleMessage {
    incident_id: string;
    target: string;
    message: string;
    severity?: 'info' | 'warn' | 'critical';
    timestamp: string;
}

/**
 * Tool wrappers for Incident Service API
 */
export class IncidentTools {
    private baseUrl: string;

    constructor(baseUrl: string = config.incidentBaseUrl) {
        this.baseUrl = baseUrl;
    }

    async getIncident(incidentId: string): Promise<Incident | null> {
        try {
            const res = await fetch(`${this.baseUrl}/incidents/${incidentId}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.success ? data.data : null;
        } catch (err) {
            console.error('[tools] getIncident error:', err);
            return null;
        }
    }

    async appendEvent(
        incidentId: string,
        actor: string,
        type: string,
        payload: Record<string, unknown>
    ): Promise<boolean> {
        try {
            const res = await fetch(`${this.baseUrl}/incidents/${incidentId}/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actor, type, payload }),
            });
            const data = await res.json();
            return data.success;
        } catch (err) {
            console.error('[tools] appendEvent error:', err);
            return false;
        }
    }

    async setState(incidentId: string, state: string): Promise<boolean> {
        try {
            const res = await fetch(`${this.baseUrl}/incidents/${incidentId}/state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state }),
            });
            const data = await res.json();
            return data.success;
        } catch (err) {
            console.error('[tools] setState error:', err);
            return false;
        }
    }

    async sendConsoleMessage(
        incidentId: string,
        target: string,
        message: string,
        severity: 'info' | 'warn' | 'critical' = 'info'
    ): Promise<boolean> {
        try {
            const res = await fetch(`${this.baseUrl}/incidents/${incidentId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target, message, severity }),
            });
            const data = await res.json();
            return data.success;
        } catch (err) {
            console.error('[tools] sendConsoleMessage error:', err);
            return false;
        }
    }
}

/**
 * Tool wrappers for Responder Services
 */
export class ResponderTools {
    async hospitalRespond(
        incidentId: string,
        action: string,
        payload: Record<string, unknown>
    ): Promise<boolean> {
        return this.callResponder(config.hospitalServiceUrl, incidentId, action, payload);
    }

    async ambulanceRespond(
        incidentId: string,
        action: string,
        payload: Record<string, unknown>
    ): Promise<boolean> {
        return this.callResponder(config.ambulanceServiceUrl, incidentId, action, payload);
    }

    async guardianRespond(
        incidentId: string,
        action: string,
        payload: Record<string, unknown>
    ): Promise<boolean> {
        return this.callResponder(config.guardianServiceUrl, incidentId, action, payload);
    }

    private async callResponder(
        serviceUrl: string,
        incidentId: string,
        action: string,
        payload: Record<string, unknown>
    ): Promise<boolean> {
        try {
            const res = await fetch(`${serviceUrl}/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ incident_id: incidentId, action, payload }),
            });
            const data = await res.json();
            return data.success;
        } catch (err) {
            console.error(`[tools] responder error (${serviceUrl}):`, err);
            return false;
        }
    }
}
