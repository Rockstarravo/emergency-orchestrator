import OpenAI from 'openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { config } from './config.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const toAbsoluteUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${config.incidentBaseUrl}${url}`;
};

export interface ImageAnalysis {
    key_observations: string[];
    flags: string[];
}

export interface AudioAnalysis {
    transcript_summary: string;
    signals: string[];
}

export async function analyzeImages(imageUrls: string[]): Promise<ImageAnalysis> {
    if (!imageUrls || imageUrls.length === 0) {
        return { key_observations: [], flags: ['no_images_provided'] };
    }

    const content: ChatCompletionContentPart[] = [
        {
            type: 'text',
            text: [
                'You are analyzing emergency attachments.',
                'Provide only observable details, not medical diagnoses.',
                'Summarize in short bullet points focusing on scene conditions, safety risks, and obvious injuries.',
                'Return JSON with key_observations and flags (flags for hazards, possible bleeding, unconsciousness, smoke, crowding, unclear_view).',
            ].join(' '),
        },
        ...imageUrls.map((url) => ({
            type: 'image_url' as const,
            image_url: { url: toAbsoluteUrl(url) },
        })),
    ];

    const completion = await openai.chat.completions.create({
        model: config.modelVision,
        messages: [
            {
                role: 'system',
                content:
                    'Analyze the provided images for safety context. Stay strictly observational and avoid guessing.',
            },
            { role: 'user', content },
        ],
        response_format: { type: 'json_object' },
    });

    const messageContent = completion.choices[0]?.message?.content ?? '{}';
    try {
        const parsed = JSON.parse(messageContent) as ImageAnalysis;
        return {
            key_observations: parsed.key_observations ?? [],
            flags: parsed.flags ?? [],
        };
    } catch {
        return {
            key_observations: [messageContent],
            flags: ['parse_error'],
        };
    }
}

export async function analyzeAudio(audioUrl: string): Promise<AudioAnalysis> {
    if (!audioUrl) {
        return { transcript_summary: '', signals: ['no_audio_provided'] };
    }

    try {
        const response = await fetch(toAbsoluteUrl(audioUrl));
        if (!response.ok) throw new Error(`Audio fetch failed: ${response.statusText}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const blob = new Blob([buffer]);

        const transcription = await openai.audio.transcriptions.create({
            file: blob as any,
            model: 'whisper-1',
        });

        const completion = await openai.chat.completions.create({
            model: config.modelText,
            messages: [
                {
                    role: 'system',
                    content:
                        'Summarize the call in 2-3 sentences. Highlight location cues, distress signals, hazards, and priority actions. Do not provide diagnosis.',
                },
                { role: 'user', content: transcription.text },
            ],
            response_format: { type: 'json_object' },
        });

        const summaryContent = completion.choices[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(summaryContent) as AudioAnalysis;
        return {
            transcript_summary: parsed.transcript_summary ?? transcription.text ?? '',
            signals: parsed.signals ?? [],
        };
    } catch (err) {
        const fallbackSummary =
            err instanceof Error ? err.message : 'Audio received; transcription pending';
        return {
            transcript_summary: fallbackSummary,
            signals: ['transcription_pending'],
        };
    }
}
