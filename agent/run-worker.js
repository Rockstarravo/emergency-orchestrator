#!/usr/bin/env node
import process from 'node:process';
import { incidentTools } from './tools/incidentTools.js';
import { runCoordinatorAgent } from './CoordinatorAgent.js';

const args = new Map();
process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--')) {
        const [key, value] = arg.replace(/^--/, '').split('=');
        args.set(key, value ?? true);
    }
});

const incidentId = args.get('incident_id') || args.get('incidentId');
if (!incidentId) {
    console.error('Usage: node agent/run-worker.js --incident_id=INC123 [--watch=true] [--interval=2000]');
    process.exit(1);
}

const watch =
    args.has('once') || args.get('watch') === 'false' || args.get('watch') === false ? false : true;
const interval = parseInt(args.get('interval') ?? '2000', 10);

let lastProcessedTs = null;
const allowedTimelineTypes = new Set([
    'incident_created',
    'state_changed',
    'hospital_response',
    'ambulance_response',
    'guardian_response',
    'message_sent',
    'system_event',
]);

const isTriggerEvent = (payload = {}) => {
    const kind = payload?.kind;
    return kind === 'attachments_added' || kind === 'audio_uploaded' || kind === 'run_agent';
};

async function seedLastTimestamp() {
    const incident = await incidentTools.getIncident(incidentId);
    lastProcessedTs = incident.timeline.length ? incident.timeline[incident.timeline.length - 1].ts : null;
}

async function applyActions(incidentId) {
    console.log(`[agent] Running coordinator for ${incidentId}`);
    const result = await runCoordinatorAgent(incidentId);
    const allowGuardian = result.policy?.allowGuardianNotify ?? false;

await incidentTools.appendEvent(incidentId, 'system', 'system_event', {
    kind: 'agent_summary',
    summary: result.summary,
    risk_level: result.risk_level,
    confidence: result.confidence,
});

    if (result.images) {
    await incidentTools.appendEvent(incidentId, 'system', 'system_event', {
        kind: 'image_analysis',
        observations: result.images.key_observations,
        flags: result.images.flags,
    });
}

    if (result.audio) {
    await incidentTools.appendEvent(incidentId, 'system', 'system_event', {
        kind: 'audio_analysis',
        transcript_summary: result.audio.transcript_summary,
        signals: result.audio.signals,
    });
}

    if (result.next_questions?.length) {
    await incidentTools.appendEvent(incidentId, 'system', 'system_event', {
        kind: 'agent_questions',
        questions: result.next_questions,
    });
}

    for (const action of result.actions) {
        try {
            if (action.type === 'console_message' && action.target === 'guardian' && !allowGuardian) {
            await incidentTools.appendEvent(incidentId, 'system', 'system_event', {
                kind: 'agent_action_taken',
                action,
                skipped: 'guardian_notification_blocked_by_policy',
            });
            continue;
            }

            if (action.type === 'set_state') {
                await incidentTools.setState(incidentId, action.state);
            } else if (action.type === 'append_event') {
                const eventType = allowedTimelineTypes.has(action.event_type)
                    ? action.event_type
                    : 'system_event';
                await incidentTools.appendEvent(incidentId, 'system', eventType, action.payload);
            } else if (action.type === 'console_message') {
                await incidentTools.sendConsoleMessage(
                    incidentId,
                    action.target,
                    action.message,
                    action.severity,
                );
            }

        await incidentTools.appendEvent(incidentId, 'system', 'system_event', {
            kind: 'agent_action_taken',
            action,
        });
        } catch (err) {
            console.error('[agent] Failed to apply action', action, err);
        }
    }

    console.log(`[agent] Completed run. Actions applied: ${result.actions.length}`);
}

async function pollLoop() {
    try {
        const events = await incidentTools.listRecentEvents(incidentId, 50);
        const newEvents = events.filter((e) => !lastProcessedTs || e.ts > lastProcessedTs);
        if (newEvents.length) {
            const latestTs = newEvents[newEvents.length - 1].ts;
            const shouldRun = newEvents.some((e) => isTriggerEvent(e.payload));
            lastProcessedTs = latestTs;
            if (shouldRun) {
                await applyActions(incidentId);
            }
        }
    } catch (err) {
        console.error('[agent] Poll error', err);
    } finally {
        if (watch) {
            setTimeout(pollLoop, interval);
        }
    }
}

(async () => {
    await seedLastTimestamp();
    if (watch) {
        console.log(`[agent] Watching incident ${incidentId} every ${interval}ms`);
        await pollLoop();
    } else {
        await applyActions(incidentId);
    }
})();
