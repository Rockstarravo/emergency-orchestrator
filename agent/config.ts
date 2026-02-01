import OpenAI from 'openai';

export const config = {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    incidentBaseUrl: process.env.INCIDENT_BASE_URL ?? 'http://localhost:4001',
    hospitalServiceUrl: process.env.HOSPITAL_SERVICE_URL ?? 'http://localhost:4002',
    ambulanceServiceUrl: process.env.AMBULANCE_SERVICE_URL ?? 'http://localhost:4003',
    guardianServiceUrl: process.env.GUARDIAN_SERVICE_URL ?? 'http://localhost:4004',
    modelText: process.env.MODEL_TEXT ?? 'gpt-4o',
    modelVision: process.env.MODEL_VISION ?? 'gpt-4o',
    modelAgent: process.env.MODEL_AGENT ?? 'gpt-4o',
    modelRealtime: process.env.MODEL_REALTIME ?? 'gpt-4o-realtime-preview',
    modelVoice: process.env.MODEL_VOICE ?? 'alloy',
    modelTranscription: process.env.MODEL_TRANSCRIPTION ?? 'whisper-1',
    gatewayPort: parseInt(process.env.REALTIME_GATEWAY_PORT ?? '4010', 10),
};

if (!config.openaiApiKey) {
    throw new Error('Missing OPENAI_API_KEY in environment.');
}

export const openai = new OpenAI({
    apiKey: config.openaiApiKey,
});
