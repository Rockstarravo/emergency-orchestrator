import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
    ApiResponse,
    ConsoleMessage,
    Incident,
    IncidentState,
    TimelineEvent,
} from '@emergency-orchestrator/shared';
import { config as agentConfig } from '../config.js';

const DEFAULT_TIMEOUT_MS = 8000;
const RETRIES = 2;

const client: AxiosInstance = axios.create({
    baseURL: agentConfig.incidentBaseUrl,
    timeout: DEFAULT_TIMEOUT_MS,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, retries = RETRIES): Promise<T> {
    let attempt = 0;
    // simple jitter to reduce thundering herd on repeated polls
    while (true) {
        try {
            return await fn();
        } catch (err) {
            attempt += 1;
            if (attempt > retries) throw err;
            await sleep(150 * attempt);
        }
    }
}

const request = async <T>(config: AxiosRequestConfig): Promise<T> => {
    return withRetry(async () => {
        const res = await client.request<ApiResponse<T>>(config);
        if (!res.data?.success) {
            throw new Error(res.data?.error || 'Unexpected Incident Service error');
        }
        return res.data.data as T;
    });
};

export const incidentTools = {
    async createIncident(metadata?: Record<string, unknown>): Promise<Incident> {
        return request<Incident>({
            method: 'POST',
            url: '/incidents',
            data: { metadata },
        });
    },

    async getIncident(incidentId: string): Promise<Incident> {
        return request<Incident>({
            method: 'GET',
            url: `/incidents/${encodeURIComponent(incidentId)}`,
        });
    },

    async appendEvent(
        incidentId: string,
        actor: TimelineEvent['actor'],
        type: TimelineEvent['type'],
        payload: Record<string, unknown>,
    ): Promise<TimelineEvent> {
        return request<TimelineEvent>({
            method: 'POST',
            url: `/incidents/${encodeURIComponent(incidentId)}/events`,
            data: { actor, type, payload },
        });
    },

    async setState(incidentId: string, state: IncidentState): Promise<Incident> {
        return request<Incident>({
            method: 'POST',
            url: `/incidents/${encodeURIComponent(incidentId)}/state`,
            data: { state },
        });
    },

    async sendConsoleMessage(
        incidentId: string,
        target: ConsoleMessage['target'],
        message: string,
        severity: ConsoleMessage['severity'] = 'info',
    ): Promise<ConsoleMessage> {
        return request<ConsoleMessage>({
            method: 'POST',
            url: `/incidents/${encodeURIComponent(incidentId)}/messages`,
            data: { target, message, severity },
        });
    },

    async listRecentEvents(incidentId: string, limit = 50): Promise<TimelineEvent[]> {
        const incident = await this.getIncident(incidentId);
        const timeline = incident.timeline ?? [];
        const sorted = [...timeline].sort((a, b) => a.ts.localeCompare(b.ts));
        return sorted.slice(-limit);
    },
};

export type IncidentTools = typeof incidentTools;
