import { openai, config } from './config';
import { Incident } from './tools';
import { MultimodalContext, buildContextSummary } from './context';

export interface AgentAction {
    type: 'append_event' | 'set_state' | 'console_message' | 'respond_service';
    event_type?: string;
    payload?: Record<string, unknown>;
    state?: string;
    target?: string;
    message?: string;
    severity?: 'info' | 'warn' | 'critical';
    service?: 'hospital' | 'ambulance' | 'guardian';
    action?: string;
}

export interface AgentDecision {
    summary: string;
    confidence: number;
    risk_level: 'low' | 'medium' | 'high';
    questions: string[];
    actions: AgentAction[];
}

const SYSTEM_INSTRUCTIONS = `You are an emergency coordination AI assistant. Your role is to:

1. **Assess urgency** based on user statements and visual observations
2. **Coordinate response** by deciding which services to notify
3. **Ask clarifying questions** (max 2) to gather critical information
4. **Maintain calm** and provide reassurance

CRITICAL RULES:
- NEVER diagnose medical conditions or prescribe treatments
- NEVER provide medical advice - always defer to emergency professionals
- Focus on coordination, location confirmation, and scene safety
- If high urgency: prioritize ambulance dispatch + location confirmation
- If guardian notification needed: check metadata.allow_guardian_notify=true OR explicit user consent
- Keep responses concise and action-oriented
- **SILENCE IS GOLDEN**: If the input is unclear, empty, or just background noise, do NOT generate an 'agent_message'. Return an empty actions list.
- **NO GENERIC FILLERS**: Do NOT say "Analyzing audio...", "I am listening...", or "Please wait...". Only speak if you have a specific question or a confirmation of action.

OUTPUT FORMAT (JSON only):
{
  "summary": "Brief assessment of situation",
  "confidence": 0.0-1.0,
  "risk_level": "low|medium|high",
  "questions": ["Question 1?", "Question 2?"],
  "actions": [
    {"type":"append_event", "event_type":"agent_message", "payload":{"text":"..."}},
    {"type":"set_state", "state":"ASSESSING"},
    {"type":"console_message", "target":"ambulance", "message":"...", "severity":"critical"},
    {"type":"respond_service", "service":"ambulance", "action":"dispatch_confirmed", "payload":{...}}
  ]
}`;

/**
 * Run the coordinator agent
 */
export async function runCoordinator(
    incident: Incident,
    context: MultimodalContext
): Promise<AgentDecision> {
    const contextSummary = buildContextSummary(incident, context);

    const prompt = `INCIDENT: ${incident.id}
STATE: ${incident.state}
CREATED: ${incident.created_at}

${contextSummary}

Analyze this emergency situation and provide your coordination decision as JSON.`;

    console.log('[coordinator] Running agent for incident:', incident.id);
    console.log('[coordinator] Context:', contextSummary.substring(0, 200));

    try {
        const response = await openai.chat.completions.create({
            model: config.modelAgent,
            messages: [
                { role: 'system', content: SYSTEM_INSTRUCTIONS },
                { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7,
            max_tokens: 1000,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error('No response from agent');
        }

        const decision: AgentDecision = JSON.parse(content);
        console.log('[coordinator] Decision:', {
            summary: decision.summary,
            confidence: decision.confidence,
            risk_level: decision.risk_level,
            actions: decision.actions.length,
        });

        // Validate decision
        // Allow empty summary ONLY if actions list is empty (Silence Policy)
        if (decision.actions.length === 0) {
            return decision;
        }

        if (!decision.summary || decision.confidence === undefined || !decision.risk_level) {
            throw new Error('Invalid decision format');
        }

        return decision;
    } catch (err: any) {
        console.error('[coordinator] Agent error:', err?.message);

        // Fallback decision
        return {
            summary: 'Error running coordinator agent',
            confidence: 0,
            risk_level: 'medium',
            questions: [],
            actions: [
                {
                    type: 'append_event',
                    event_type: 'agent_message',
                    payload: { text: `Coordinator error: ${err?.message || 'Unknown error'}` },
                },
            ],
        };
    }
}
