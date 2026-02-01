export type RiskLevel = 'low' | 'medium' | 'high';

export interface PolicyDecision {
    allowGuardianNotify: boolean;
    mustAskClarifying: boolean;
    notes: string[];
}

export interface PolicyInput {
    metadata?: Record<string, unknown>;
    confidence: number;
}

const GUARDIAN_FLAG = 'allow_guardian_autonotify';

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
    const allowGuardianNotify = Boolean(input.metadata?.[GUARDIAN_FLAG]) === true;
    const mustAskClarifying = input.confidence < 0.4;

    const notes: string[] = [
        'Never provide medical diagnosis; direct users to emergency professionals.',
        'If unsure, collect 1-2 clarifying details before dispatching.',
    ];

    if (!allowGuardianNotify) {
        notes.push('Do not notify guardian without explicit consent or metadata flag.');
    }

    return {
        allowGuardianNotify,
        mustAskClarifying,
        notes,
    };
}
