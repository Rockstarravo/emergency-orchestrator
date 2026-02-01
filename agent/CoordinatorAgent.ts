import { Agent, Runner, tool } from '@openai/agents';
import { setDefaultOpenAIKey } from '@openai/agents-openai';
import { z } from 'zod';
import {
    Incident,
    IncidentState,
    TimelineEvent,
    ConsoleTarget,
} from '@emergency-orchestrator/shared';
import { config } from './config.js';
import { incidentTools } from './tools/incidentTools.js';
import { analyzeAudio, analyzeImages, AudioAnalysis, ImageAnalysis } from './multimodal.js';
import { evaluatePolicy, PolicyDecision } from './policy.js';

setDefaultOpenAIKey(config.openaiApiKey);

export type CoordinatorAction =
    | { type: 'set_state'; state: IncidentState }
    | { type: 'append_event'; event_type: string; payload: Record<string, unknown> }
    | {
          type: 'console_message';
          target: ConsoleTarget;
          message: string;
          severity?: 'info' | 'warning' | 'error' | 'success';
      };

export interface CoordinatorResult {
    summary: string;
    confidence: number;
    risk_level: 'low' | 'medium' | 'high';
    next_questions: string[];
    actions: CoordinatorAction[];
    images?: ImageAnalysis | null;
    audio?: AudioAnalysis | null;
    policy?: PolicyDecision;
}

export interface CoordinatorContext {
    incidentId: string;
    incident: Incident;
    recentEvents: TimelineEvent[];
    images: ImageAnalysis | null;
    audio: AudioAnalysis | null;
    policy: PolicyDecision;
}

const actionSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('set_state'),
        state: z.nativeEnum(IncidentState),
    }),
    z.object({
        type: z.literal('append_event'),
        event_type: z.string(),
        payload: z.record(z.string(), z.any()),
    }),
    z.object({
        type: z.literal('console_message'),
        target: z.enum(['hospital', 'ambulance', 'guardian', 'command', 'emergency']),
        message: z.string(),
        severity: z.enum(['info', 'warning', 'error', 'success']).optional(),
    }),
]);

const outputSchema = z.object({
    summary: z.string(),
    confidence: z.number().min(0).max(1),
    risk_level: z.enum(['low', 'medium', 'high']),
    next_questions: z.array(z.string()).max(4),
    actions: z.array(actionSchema).default([]),
});

const coordinatorAgent = new Agent<CoordinatorContext, typeof outputSchema>({
    name: 'Coordinator Agent',
    model: config.modelText,
    instructions: (runContext) => {
        const ctx = runContext.context;
        const meta = JSON.stringify(ctx.incident.metadata ?? {});
        const policyNotes = ctx.policy.notes.join(' ');
        return [
            'You are a calm emergency coordinator. Provide short, decisive guidance.',
            'Never provide medical diagnoses. Direct users to professional emergency services.',
            'Prefer clarifying questions when confidence is low.',
            'Guardian notifications require explicit consent; do not include unless allowed.',
            `Incident state: ${ctx.incident.state}. Metadata: ${meta}.`,
            `Policy notes: ${policyNotes}`,
            'Output must be valid JSON matching the schema (summary, confidence 0-1, risk_level, next_questions, actions).',
        ].join(' ');
    },
    handoffDescription: 'Coordinates emergency response actions based on incident timeline and attachments.',
    tools: [
        tool({
            name: 'append_event',
            description: 'Append a structured agent timeline event to the incident.',
            parameters: z.object({
                event_type: z.string(),
                payload: z.record(z.string(), z.any()),
            }),
            strict: true,
            execute: async (input, runCtx) => {
                const incidentId = runCtx?.context.incidentId;
                if (!incidentId) throw new Error('Missing incident id in context');
                const event = await incidentTools.appendEvent(
                    incidentId,
                    'system',
                    input.event_type as TimelineEvent['type'],
                    input.payload,
                );
                return JSON.stringify(event);
            },
        }),
        tool({
            name: 'set_state',
            description: 'Update the incident state when escalation or resolution is needed.',
            parameters: z.object({
                state: z.nativeEnum(IncidentState),
            }),
            strict: true,
            execute: async (input, runCtx) => {
                const incidentId = runCtx?.context.incidentId;
                if (!incidentId) throw new Error('Missing incident id in context');
                const updated = await incidentTools.setState(incidentId, input.state);
                return JSON.stringify({ state: updated.state });
            },
        }),
        tool({
            name: 'send_console_message',
            description: 'Send a concise console message to a specific target (hospital, ambulance, guardian, command, emergency).',
            parameters: z.object({
                target: z.enum(['hospital', 'ambulance', 'guardian', 'command', 'emergency']),
                message: z.string(),
                severity: z.enum(['info', 'warning', 'error', 'success']).optional(),
            }),
            strict: true,
            execute: async (input, runCtx) => {
                const incidentId = runCtx?.context.incidentId;
                if (!incidentId) throw new Error('Missing incident id in context');
                const res = await incidentTools.sendConsoleMessage(
                    incidentId,
                    input.target,
                    input.message,
                    input.severity ?? 'info',
                );
                return JSON.stringify(res);
            },
        }),
    ],
    outputType: outputSchema,
});

const runner = new Runner();

const formatTimeline = (events: TimelineEvent[]): string => {
    return events
        .slice(-20)
        .map((e) => `${e.ts} [${e.actor}/${e.type}] ${JSON.stringify(e.payload)}`)
        .join('\n');
};

const describeAnalysis = (analysis: ImageAnalysis | null, audio: AudioAnalysis | null): string => {
    const parts: string[] = [];
    if (analysis) {
        parts.push(
            `Image observations: ${analysis.key_observations.join('; ')}. Flags: ${analysis.flags.join(', ')}`,
        );
    }
    if (audio) {
        parts.push(`Audio summary: ${audio.transcript_summary}. Signals: ${audio.signals.join(', ')}`);
    }
    return parts.join('\n');
};

export async function runCoordinatorAgent(incidentId: string): Promise<CoordinatorResult> {
    const incident = await incidentTools.getIncident(incidentId);
    const recentEvents = await incidentTools.listRecentEvents(incidentId, 50);

    const imageAttachments =
        recentEvents
            .filter((e) => e.payload?.kind === 'attachments_added')
            .flatMap((e) => (e.payload as { attachments?: Array<{ url?: string }> })?.attachments ?? [])
            .map((a) => a.url)
            .filter((url): url is string => Boolean(url)) ?? [];

    const audioEvent = [...recentEvents].reverse().find((e) => e.payload?.kind === 'audio_uploaded');
    const audioPayload = audioEvent?.payload as { audio?: { url?: string } } | undefined;
    const audioUrl = audioPayload?.audio?.url ?? null;

    const [imageAnalysis, audioAnalysis] = await Promise.all([
        analyzeImages(imageAttachments),
        audioUrl ? analyzeAudio(audioUrl as string) : Promise.resolve(null),
    ]);

    const confidenceBaseline = imageAnalysis?.key_observations?.length ? 0.55 : 0.35;
    const policy = evaluatePolicy({ metadata: incident.metadata, confidence: confidenceBaseline });

    const inputContext = [
        `Incident ${incident.id}`,
        `Current state: ${incident.state}`,
        `Metadata: ${JSON.stringify(incident.metadata ?? {})}`,
        `Recent timeline:\n${formatTimeline(recentEvents)}`,
        `Analysis:\n${describeAnalysis(imageAnalysis, audioAnalysis)}`,
        policy.mustAskClarifying
            ? 'Confidence is low; include up to 2 clarifying questions before dispatch.'
            : 'Confidence sufficient; propose concrete next steps.',
        policy.allowGuardianNotify
            ? 'Guardian notifications allowed per metadata.'
            : 'Do not notify guardian unless explicitly requested.',
        'Provide concise, safety-first guidance.',
    ].join('\n');

    const result = await runner.run(coordinatorAgent, inputContext, {
        context: {
            incidentId,
            incident,
            recentEvents,
            images: imageAnalysis,
            audio: audioAnalysis,
            policy,
        },
    });

    const baseFallback: CoordinatorResult = {
        summary: 'No output generated',
        confidence: confidenceBaseline,
        risk_level: 'medium',
        next_questions: ['Can you confirm the exact location?', 'Is anyone unconscious or bleeding?'],
        actions: [],
        images: imageAnalysis,
        audio: audioAnalysis,
        policy,
    };

    const finalOutput = result.finalOutput;
    if (!finalOutput) {
        return baseFallback;
    }

    return {
        ...finalOutput,
        images: imageAnalysis,
        audio: audioAnalysis,
        policy,
    };
}
