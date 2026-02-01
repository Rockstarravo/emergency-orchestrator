import { openai, config } from './config';
import { Incident, TimelineEvent } from './tools';

export interface MultimodalContext {
    captions: string[];
    imageAnalysis: string | null;
    audioUrls: string[];
}

/**
 * Extract multimodal context from incident timeline
 */
export async function buildMultimodalContext(incident: Incident): Promise<MultimodalContext> {
    const captions: string[] = [];
    const imageUrls: string[] = [];
    const audioUrls: string[] = [];

    // Extract from timeline
    for (const event of incident.timeline) {
        // Extract live captions (user utterances)
        if (event.type === 'live_caption_final' && event.payload.text) {
            captions.push(String(event.payload.text));
        }

        // Extract image URLs
        if (event.type === 'system_event' && event.payload.kind === 'attachments_added') {
            const attachments = event.payload.attachments as any[];
            if (Array.isArray(attachments)) {
                for (const att of attachments) {
                    if (att.url && att.type?.startsWith('image/')) {
                        imageUrls.push(att.url);
                    }
                }
            }
        }

        // Extract audio URLs
        if (event.type === 'system_event' && event.payload.kind === 'audio_uploaded') {
            const audio = event.payload.audio as any;
            if (audio?.url) {
                audioUrls.push(audio.url);
            }
        }
    }

    // Analyze images with GPT-4 Vision if any exist
    let imageAnalysis: string | null = null;
    if (imageUrls.length > 0) {
        imageAnalysis = await analyzeImages(imageUrls, incident.id);
    }

    return { captions, imageAnalysis, audioUrls };
}

/**
 * Analyze images using GPT-4 Vision
 */
async function analyzeImages(imageUrls: string[], incidentId: string): Promise<string> {
    try {
        // Build full URLs (convert relative to absolute)
        const fullUrls = imageUrls.map(url => {
            if (url.startsWith('http')) return url;
            return `${config.incidentBaseUrl}${url}`;
        });

        const messages: any[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Analyze these emergency scene images. Provide OBSERVATIONS ONLY (no diagnosis):
- Visible injuries or conditions
- Scene safety concerns
- Number of people visible
- Environmental hazards
- Medical equipment visible
Be concise (2-3 sentences per image). Focus on facts, not medical conclusions.`,
                    },
                    ...fullUrls.slice(0, 3).map(url => ({
                        type: 'image_url',
                        image_url: { url, detail: 'high' },
                    })),
                ],
            },
        ];

        const response = await openai.chat.completions.create({
            model: config.modelVision,
            messages,
            max_tokens: 400,
        });

        const analysis = response.choices[0]?.message?.content || 'Unable to analyze images';
        console.log('[context] Image analysis:', analysis.substring(0, 100));
        return analysis;
    } catch (err: any) {
        console.error('[context] Image analysis error:', err?.message);
        return `Error analyzing images: ${err?.message || 'Unknown error'}`;
    }
}

/**
 * Build context summary for agent
 */
export function buildContextSummary(
    incident: Incident,
    context: MultimodalContext
): string {
    const parts: string[] = [];

    // Incident metadata
    if (incident.metadata) {
        const meta = incident.metadata as any;
        if (meta.summary) parts.push(`Summary: ${meta.summary}`);
        if (meta.location) parts.push(`Location: ${meta.location}`);
        if (meta.severity) parts.push(`Severity: ${meta.severity}`);
    }

    // User captions
    if (context.captions.length > 0) {
        parts.push(`\nUser statements (${context.captions.length}):`);
        context.captions.slice(-5).forEach((caption, i) => {
            parts.push(`${i + 1}. "${caption}"`);
        });
    }

    // Image analysis
    if (context.imageAnalysis) {
        parts.push(`\nImage Analysis:\n${context.imageAnalysis}`);
    }

    // Audio
    if (context.audioUrls.length > 0) {
        parts.push(`\nAudio recordings: ${context.audioUrls.length} file(s)`);
    }

    return parts.join('\n');
}
