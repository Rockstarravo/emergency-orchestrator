import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import {
    Incident,
    IncidentState,
    TimelineEvent,
    ConsoleMessage,
    WsEvent,
    ApiResponse,
} from '@emergency-orchestrator/shared';
import { IncidentStore } from './store';
import { WsManager } from './ws-manager';
import { getSuggestion } from './suggest';

const PORT = parseInt(process.env.PORT || '4001', 10);
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

const app = Fastify({ logger: true });
const store = new IncidentStore();
const wsManager = new WsManager();
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// Register WebSocket plugin
app.register(websocket);
app.register(multipart, {
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 12,
    },
});
app.register(fastifyStatic, {
    root: UPLOAD_ROOT,
    prefix: '/uploads/',
});

type StoredFile = {
    id: string;
    name: string;
    type: string;
    size: number;
    url: string;
};

const ensureDir = async (dir: string) => {
    await fs.promises.mkdir(dir, { recursive: true });
};

// Basic CORS for browser requests
app.addHook('onSend', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
});
app.options('/*', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.code(204).send();
});

/**
 * GET /incidents - List all incidents
 */
app.get('/incidents', async (request, reply) => {
    const incidents = store.list();
    const response: ApiResponse<Incident[]> = {
        success: true,
        data: incidents,
    };
    reply.send(response);
});


/**
 * POST /incidents - Create a new incident
 */
app.post<{
    Body: {
        metadata?: Record<string, unknown>;
    };
}>('/incidents', async (request, reply) => {
    const { metadata = {} } = request.body;

    const incident: Incident = {
        id: `INC${nanoid(8).toUpperCase()}`,
        state: IncidentState.CREATED,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata,
        timeline: [
            {
                ts: new Date().toISOString(),
                actor: 'system',
                type: 'incident_created',
                payload: { metadata },
            },
        ],
    };

    store.create(incident);

    // Broadcast incident creation
    const event: WsEvent = {
        event_type: 'incident_created',
        incident_id: incident.id,
        timestamp: new Date().toISOString(),
        payload: { incident },
    };
    wsManager.broadcast(incident.id, event);

    const response: ApiResponse<Incident> = {
        success: true,
        data: incident,
    };

    reply.code(201).send(response);
});

/**
 * GET /incidents/:id - Get incident details
 */
app.get<{
    Params: { id: string };
}>('/incidents/:id', async (request, reply) => {
    const { id } = request.params;
    const incident = store.get(id);

    if (!incident) {
        const response: ApiResponse = {
            success: false,
            error: 'Incident not found',
        };
        return reply.code(404).send(response);
    }

    const response: ApiResponse<Incident> = {
        success: true,
        data: incident,
    };

    reply.send(response);
});

/**
 * POST /incidents/:id/events - Append timeline event
 */
app.post<{
    Params: { id: string };
    Body: Omit<TimelineEvent, 'ts'>;
}>('/incidents/:id/events', async (request, reply) => {
    const { id } = request.params;
    const eventData = request.body;

    if (!eventData.actor || !eventData.type || !eventData.payload) {
        const response: ApiResponse = {
            success: false,
            error: 'Missing required fields: actor, type, payload',
        };
        return reply.code(400).send(response);
    }

    const event: TimelineEvent = {
        ...eventData,
        ts: new Date().toISOString(),
    };

    const incident = store.appendTimeline(id, event);

    if (!incident) {
        const response: ApiResponse = {
            success: false,
            error: 'Incident not found',
        };
        return reply.code(404).send(response);
    }

    // Broadcast timeline event
    const wsEvent: WsEvent = {
        event_type: 'timeline_event',
        incident_id: id,
        timestamp: new Date().toISOString(),
        payload: { event },
    };
    wsManager.broadcast(id, wsEvent);

    const response: ApiResponse<TimelineEvent> = {
        success: true,
        data: event,
    };

    reply.send(response);
});

/**
 * POST /incidents/:id/attachments - Upload attachments
 */
app.post<{
    Params: { id: string };
}>('/incidents/:id/attachments', async (request, reply) => {
    const { id } = request.params;
    const incident = store.get(id);
    if (!incident) {
        const response: ApiResponse = { success: false, error: 'Incident not found' };
        return reply.code(404).send(response);
    }

    const parts = await request.saveRequestFiles();
    const files = parts.filter((f) => f.fieldname === 'files' || f.fieldname === 'file');
    if (files.length === 0) {
        const response: ApiResponse = { success: false, error: 'No files provided' };
        return reply.code(400).send(response);
    }

    const targetDir = path.join(UPLOAD_ROOT, id, 'attachments');
    await ensureDir(targetDir);

    const attachments: StoredFile[] = [];
    for (const file of files) {
        const buf = await fs.promises.readFile(file.filepath);
        const ext = path.extname(file.filename);
        const generatedId = `ATT${nanoid(10)}`;
        const storedName = `${generatedId}${ext}`;
        const destPath = path.join(targetDir, storedName);
        await fs.promises.writeFile(destPath, buf);

        attachments.push({
            id: generatedId,
            name: file.filename,
            type: file.mimetype,
            size: buf.length,
            url: `/uploads/${id}/attachments/${storedName}`,
        });
    }

    // timeline event
    const event: TimelineEvent = {
        ts: new Date().toISOString(),
        actor: 'emergency',
        type: 'system_event',
        payload: { kind: 'attachments_added', attachments },
    };
    const updated = store.appendTimeline(id, event);
    if (!updated) {
        const response: ApiResponse = { success: false, error: 'Incident not found' };
        return reply.code(404).send(response);
    }
    const wsEvent: WsEvent = {
        event_type: 'timeline_event',
        incident_id: id,
        timestamp: new Date().toISOString(),
        payload: { event },
    };
    wsManager.broadcast(id, wsEvent);

    const response: ApiResponse<{ attachments: StoredFile[] }> = {
        success: true,
        data: { attachments },
    };
    return reply.code(201).send(response);
});

/**
 * POST /incidents/:id/audio - Upload audio
 */
app.post<{
    Params: { id: string };
}>('/incidents/:id/audio', async (request, reply) => {
    const { id } = request.params;
    const incident = store.get(id);
    if (!incident) {
        const response: ApiResponse = { success: false, error: 'Incident not found' };
        return reply.code(404).send(response);
    }

    const parts = await request.saveRequestFiles();
    const file = parts.find((f) => f.fieldname === 'file' || f.fieldname === 'audio');
    if (!file) {
        const response: ApiResponse = { success: false, error: 'No audio file provided' };
        return reply.code(400).send(response);
    }

    const targetDir = path.join(UPLOAD_ROOT, id, 'audio');
    await ensureDir(targetDir);

    const buf = await fs.promises.readFile(file.filepath);
    const ext = path.extname(file.filename);
    const generatedId = `AUD${nanoid(10)}`;
    const storedName = `${generatedId}${ext || '.bin'}`;
    const destPath = path.join(targetDir, storedName);
    await fs.promises.writeFile(destPath, buf);

    const audio: StoredFile = {
        id: generatedId,
        name: file.filename,
        type: file.mimetype,
        size: buf.length,
        url: `/uploads/${id}/audio/${storedName}`,
    };

    const event: TimelineEvent = {
        ts: new Date().toISOString(),
        actor: 'emergency',
        type: 'system_event',
        payload: { kind: 'audio_uploaded', audio },
    };
    const updated = store.appendTimeline(id, event);
    if (!updated) {
        const response: ApiResponse = { success: false, error: 'Incident not found' };
        return reply.code(404).send(response);
    }
    const wsEvent: WsEvent = {
        event_type: 'timeline_event',
        incident_id: id,
        timestamp: new Date().toISOString(),
        payload: { event },
    };
    wsManager.broadcast(id, wsEvent);

    const response: ApiResponse<{ audio: StoredFile }> = {
        success: true,
        data: { audio },
    };
    return reply.code(201).send(response);
});

/**
 * POST /incidents/:id/suggest - Stub suggestion
 */
app.post<{
    Params: { id: string };
    Body: { audio_id?: string; attachments?: Array<{ id?: string; url?: string; name?: string }> };
}>('/incidents/:id/suggest', async (request, reply) => {
    const { id } = request.params;
    const incident = store.get(id);
    if (!incident) {
        const response: ApiResponse = { success: false, error: 'Incident not found' };
        return reply.code(404).send(response);
    }

    const suggestion = getSuggestion(request.body);

    // If no text suggestion (or null), do not append to timeline.
    if (!suggestion.text) {
        return reply.send({ success: true, data: { text: null } });
    }

    const event: TimelineEvent = {
        ts: new Date().toISOString(),
        actor: 'emergency',
        type: 'message_sent',
        payload: { kind: 'suggestion', text: suggestion.text },
    };
    store.appendTimeline(id, event);
    const wsEvent: WsEvent = {
        event_type: 'timeline_event',
        incident_id: id,
        timestamp: new Date().toISOString(),
        payload: { event },
    };
    wsManager.broadcast(id, wsEvent);

    const response: ApiResponse<{ text: string }> = {
        success: true,
        data: { text: suggestion.text },
    };
    reply.send(response);
});

/**
 * POST /incidents/:id/state - Update incident state
 */
app.post<{
    Params: { id: string };
    Body: { state: IncidentState };
}>('/incidents/:id/state', async (request, reply) => {
    const { id } = request.params;
    const { state } = request.body;

    if (!state || !Object.values(IncidentState).includes(state)) {
        const response: ApiResponse = {
            success: false,
            error: 'Invalid state',
        };
        return reply.code(400).send(response);
    }

    const incident = store.updateState(id, state);

    if (!incident) {
        const response: ApiResponse = {
            success: false,
            error: 'Incident not found',
        };
        return reply.code(404).send(response);
    }

    // Add state change to timeline
    const event: TimelineEvent = {
        ts: new Date().toISOString(),
        actor: 'system',
        type: 'state_changed',
        payload: { state },
    };
    store.appendTimeline(id, event);

    // Broadcast state change
    const wsEvent: WsEvent = {
        event_type: 'state_changed',
        incident_id: id,
        timestamp: new Date().toISOString(),
        payload: { state, incident },
    };
    wsManager.broadcast(id, wsEvent);

    const response: ApiResponse<Incident> = {
        success: true,
        data: incident,
    };

    reply.send(response);
});

/**
 * POST /incidents/:id/messages - Broadcast console message
 */
app.post<{
    Params: { id: string };
    Body: Omit<ConsoleMessage, 'incident_id' | 'timestamp'>;
}>('/incidents/:id/messages', async (request, reply) => {
    const { id } = request.params;
    const { target, message, severity = 'info' } = request.body;

    if (!target || !message) {
        const response: ApiResponse = {
            success: false,
            error: 'Missing required fields: target, message',
        };
        return reply.code(400).send(response);
    }

    const incident = store.get(id);
    if (!incident) {
        const response: ApiResponse = {
            success: false,
            error: 'Incident not found',
        };
        return reply.code(404).send(response);
    }

    const consoleMessage: ConsoleMessage = {
        incident_id: id,
        target,
        message,
        severity,
        timestamp: new Date().toISOString(),
    };

    // Broadcast console message
    const wsEvent: WsEvent = {
        event_type: 'console_message',
        incident_id: id,
        timestamp: new Date().toISOString(),
        payload: consoleMessage as unknown as Record<string, unknown>,
    };
    wsManager.broadcast(id, wsEvent);

    const response: ApiResponse<ConsoleMessage> = {
        success: true,
        data: consoleMessage,
    };

    reply.send(response);
});

/**
 * WebSocket endpoint - Subscribe to incident updates
 * GET /ws?incident_id=INC123
 */
app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket, request) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const incidentId = url.searchParams.get('incident_id');

        if (!incidentId) {
            socket.close(1008, 'Missing incident_id parameter');
            return;
        }

        // Verify incident exists
        const incident = store.get(incidentId);
        if (!incident) {
            socket.close(1008, 'Incident not found');
            return;
        }

        // Subscribe to incident room
        wsManager.subscribe(incidentId, socket);

        // Send initial state
        const welcomeEvent: WsEvent = {
            event_type: 'incident_updated',
            incident_id: incidentId,
            timestamp: new Date().toISOString(),
            payload: { incident },
        };
        socket.send(JSON.stringify(welcomeEvent));

        app.log.info(`WebSocket client subscribed to incident ${incidentId}`);

        socket.on('close', () => {
            app.log.info(`WebSocket client unsubscribed from incident ${incidentId}`);
        });
    });
});

/**
 * Health check
 */
app.get('/health', async () => {
    return { status: 'ok', service: 'incident' };
});

/**
 * Start server
 */
const start = async () => {
    try {
        await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`\n🚨 Incident Service running on http://localhost:${PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
