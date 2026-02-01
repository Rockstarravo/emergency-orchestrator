import { IncidentTools, ResponderTools, Incident } from './tools';
import { buildMultimodalContext } from './context';
import { runCoordinator, AgentDecision } from './coordinator';

const incidentTools = new IncidentTools();
const responderTools = new ResponderTools();

// Track last processed event to avoid loops
const lastProcessedTs = new Map<string, string>();

/**
 * Apply agent actions to incident
 */
async function applyActions(incidentId: string, decision: AgentDecision): Promise<void> {
    console.log(`[runner] Applying ${decision.actions.length} actions for ${incidentId}`);

    for (const action of decision.actions) {
        try {
            switch (action.type) {
                case 'append_event':
                    if (action.event_type && action.payload) {
                        await incidentTools.appendEvent(
                            incidentId,
                            'agent',
                            action.event_type,
                            action.payload
                        );
                        console.log(`[runner] ✓ Appended event: ${action.event_type}`);
                    }
                    break;

                case 'set_state':
                    if (action.state) {
                        await incidentTools.setState(incidentId, action.state);
                        console.log(`[runner] ✓ Set state: ${action.state}`);
                    }
                    break;

                case 'console_message':
                    if (action.target && action.message) {
                        await incidentTools.sendConsoleMessage(
                            incidentId,
                            action.target,
                            action.message,
                            action.severity || 'info'
                        );
                        console.log(`[runner] ✓ Console message to: ${action.target}`);
                    }
                    break;

                case 'respond_service':
                    if (action.service && action.action && action.payload) {
                        let success = false;
                        switch (action.service) {
                            case 'hospital':
                                success = await responderTools.hospitalRespond(
                                    incidentId,
                                    action.action,
                                    action.payload
                                );
                                break;
                            case 'ambulance':
                                success = await responderTools.ambulanceRespond(
                                    incidentId,
                                    action.action,
                                    action.payload
                                );
                                break;
                            case 'guardian':
                                success = await responderTools.guardianRespond(
                                    incidentId,
                                    action.action,
                                    action.payload
                                );
                                break;
                        }
                        console.log(`[runner] ${success ? '✓' : '✗'} Service respond: ${action.service}/${action.action}`);
                    }
                    break;

                default:
                    console.warn(`[runner] Unknown action type: ${action.type}`);
            }
        } catch (err: any) {
            console.error(`[runner] Action error (${action.type}):`, err?.message);
        }
    }



    // Append agent summary ONLY if actions were taken
    if (decision.actions.length > 0) {
        await incidentTools.appendEvent(incidentId, 'agent', 'agent_summary', {
            summary: decision.summary,
            confidence: decision.confidence,
            risk_level: decision.risk_level,
            questions: decision.questions,
        });
        console.log('[runner] ✓ Appended agent summary');
    } else {
        console.log('[runner] 0 actions taken - suppressing agent summary');
    }
}

/**
 * Run agent for a specific incident
 */
export async function runAgentForIncident(incidentId: string): Promise<void> {
    console.log(`\n[runner] ========== Running agent for ${incidentId} ==========`);

    try {
        // Fetch incident
        const incident = await incidentTools.getIncident(incidentId);
        if (!incident) {
            console.error('[runner] Incident not found:', incidentId);
            return;
        }

        // Check idempotency - get last event timestamp
        const lastEvent = incident.timeline[incident.timeline.length - 1];
        const lastTs = lastProcessedTs.get(incidentId);
        if (lastTs && lastEvent.ts === lastTs) {
            console.log('[runner] Already processed this event, skipping');
            return;
        }

        // Build multimodal context
        console.log('[runner] Building context...');
        const context = await buildMultimodalContext(incident);
        console.log(`[runner] Context: ${context.captions.length} captions, ${context.imageAnalysis ? 'image analysis' : 'no images'}`);

        // If we have image analysis, append it to timeline
        if (context.imageAnalysis) {
            await incidentTools.appendEvent(incidentId, 'agent', 'image_analysis', {
                analysis: context.imageAnalysis,
            });
            console.log('[runner] ✓ Appended image analysis');
        }

        // Run coordinator
        console.log('[runner] Running coordinator...');
        const decision = await runCoordinator(incident, context);

        // Apply actions
        await applyActions(incidentId, decision);

        // Update last processed timestamp
        lastProcessedTs.set(incidentId, lastEvent.ts);

        console.log(`[runner] ========== Agent completed for ${incidentId} ==========\n`);
    } catch (err: any) {
        console.error('[runner] Fatal error:', err);

        // Try to log error to incident
        try {
            await incidentTools.appendEvent(incidentId, 'agent', 'agent_error', {
                error: err?.message || 'Unknown error',
            });
        } catch { }
    }
}

/**
 * Watch for run_agent events (manual trigger mode)
 */
export async function watchIncident(incidentId: string, pollIntervalMs: number = 2000): Promise<void> {
    console.log(`[runner] Watching incident ${incidentId} for run_agent events...`);
    console.log(`[runner] Poll interval: ${pollIntervalMs}ms`);

    let lastCheckTs = new Date().toISOString();

    setInterval(async () => {
        try {
            const incident = await incidentTools.getIncident(incidentId);
            if (!incident) return;

            // Check for new run_agent events
            const newEvents = incident.timeline.filter(
                (e) => e.ts > lastCheckTs && e.type === 'run_agent'
            );

            if (newEvents.length > 0) {
                console.log(`[runner] Detected ${newEvents.length} run_agent event(s)`);
                await runAgentForIncident(incidentId);
                lastCheckTs = new Date().toISOString();
            }
        } catch (err: any) {
            console.error('[runner] Watch error:', err?.message);
        }
    }, pollIntervalMs);
}
