import Fastify from 'fastify';
import { ServiceResponse, ApiResponse, HttpClient } from '@emergency-orchestrator/shared';

const PORT = parseInt(process.env.PORT || '4002', 10);
const INCIDENT_SERVICE_URL = process.env.INCIDENT_SERVICE_URL || 'http://localhost:4001';

const app = Fastify({ logger: true });
const incidentClient = new HttpClient(INCIDENT_SERVICE_URL);

/**
 * POST /respond - Handle hospital response
 */
app.post<{
    Body: ServiceResponse;
}>('/respond', async (request, reply) => {
    const { incident_id, action, payload } = request.body;

    if (!incident_id || !action || !payload) {
        const response: ApiResponse = {
            success: false,
            error: 'Missing required fields: incident_id, action, payload',
        };
        return reply.code(400).send(response);
    }

    try {
        // Append timeline event to incident
        await incidentClient.post(`/incidents/${incident_id}/events`, {
            actor: 'hospital',
            type: 'hospital_response',
            payload: {
                action,
                ...payload,
            },
        });

        // Optionally update state based on action
        if (action === 'bed_confirmed') {
            await incidentClient.post(`/incidents/${incident_id}/state`, {
                state: 'BED_CONFIRMED',
            });
        }

        // Broadcast console message
        await incidentClient.post(`/incidents/${incident_id}/messages`, {
            target: 'command',
            message: `Hospital responded: ${action}`,
            severity: 'info',
        });

        const response: ApiResponse = {
            success: true,
            data: { incident_id, action },
        };

        reply.send(response);
    } catch (error) {
        app.log.error(error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to process hospital response',
        };
        reply.code(500).send(response);
    }
});

/**
 * Health check
 */
app.get('/health', async () => {
    return { status: 'ok', service: 'hospital' };
});

/**
 * Start server
 */
const start = async () => {
    try {
        await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`\n🏥 Hospital Service running on http://localhost:${PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
