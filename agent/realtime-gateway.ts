import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { config } from './config.js';

type IncidentEvent = {
  actor: string;
  type: string;
  payload: Record<string, unknown>;
};

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const log = (...args: any[]) => console.log('[gateway]', ...args);

async function analyzeImageWithVision(
  imageData: string,
  mimeType: string,
  conversationHistory: Array<{ role: 'user' | 'assistant', content: string }> = []
): Promise<string> {
  try {
    // Build messages array with conversation history + image
    const messages: any[] = [];

    // Add recent conversation history (last 5 messages for context)
    const recentHistory = conversationHistory.slice(-5);
    recentHistory.forEach(msg => {
      messages.push({ role: msg.role, content: msg.content });
    });

    // Add current image analysis request
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Analyze this medical image/document. Identify: injuries, vital signs, medical conditions, medications, allergies. Be very concise (1-2 sentences). Focus on what is medically relevant.'
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${imageData}`,
            detail: 'high'
          }
        }
      ]
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 300
    });

    return response.choices[0]?.message?.content || 'Unable to analyze image';
  } catch (err: any) {
    log('vision api error', err?.message || err);
    return `Error analyzing image: ${err?.message || 'Unknown error'}`;
  }
}


function buildWavDataUrl(chunks: Buffer[], sampleRate: number): string | null {
  if (!chunks.length) return null;
  const pcm = Buffer.concat(chunks);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

const wss = new WebSocketServer({ port: config.gatewayPort });

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const incidentId = url.searchParams.get('incident_id');
  if (!incidentId) {
    ws.close(1008, 'Missing incident_id');
    return;
  }

  let openaiWs: WebSocket | null = null;
  let closed = false;
  let pendingBytes = 0;
  let pendingCommitTimer: NodeJS.Timeout | null = null;
  let responsePending = false;
  let clientSampleRate = 24000;
  let commitThreshold = Math.ceil(clientSampleRate * 2 * 0.2); // 200ms mono pcm16
  let flushThreshold = Math.ceil(clientSampleRate * 2 * 0.1); // 100ms mono pcm16
  let openaiReady = false;
  let pendingResponseText = '';
  let pendingAudioChunks: Buffer[] = [];
  let pendingAudioComplete = false;
  let pendingAudioRef = '';
  let pendingAudioBytes = 0;

  let isAgentSpeaking = false;
  let lastAgentSpeechTime = 0;
  const recentAgentTranscripts: string[] = []; // for echo cancellation

  // Track conversation history for Vision API context
  const conversationHistory: Array<{ role: 'user' | 'assistant', content: string }> = [];
  let preOpenaiBuffer: Buffer[] = [];
  let preOpenaiBufferedBytes = 0;
  const MAX_PREOPENAI_BYTES = 256_000; // ~2-3s of mono PCM16 @48k

  log('client connected', { incidentId });

  const postTimeline = (event: IncidentEvent) => {
    try {
      fetch(`${config.incidentBaseUrl}/incidents/${incidentId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      }).catch(err => log('failed to post timeline event', err.message));
    } catch { }
  };

  const scheduleResponseCreate = () => {
    if (responsePending) return;
    responsePending = true;
    setTimeout(() => {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
      openaiWs.send(JSON.stringify({ type: 'response.create' }));
    }, 50);
  };
  // ... (keeping closeAll same, but resetting flags) ...
  const closeAll = () => {
    if (closed) return;
    closed = true;
    try { openaiWs?.close(); } catch { }
    try { ws.close(); } catch { }
    pendingBytes = 0;
    if (pendingCommitTimer) {
      clearTimeout(pendingCommitTimer);
      pendingCommitTimer = null;
    }
    responsePending = false;
    openaiReady = false;
    pendingResponseText = '';
    pendingAudioChunks = [];
    pendingAudioComplete = false;
    pendingAudioRef = '';
    pendingAudioBytes = 0;
    isAgentSpeaking = false;
  };

  const connectOpenAI = () => {
    if (openaiWs) return;

    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
    openaiWs = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${config.openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    openaiWs.onopen = () => {
      log('openai connected');
      openaiReady = true;
      openaiWs?.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
          voice: 'alloy',
          instructions: `You are an emergency response AI dispatcher. Act like a professional human operator.

Core behavior:
- Be calm, concise, and direct.
- Ask minimal, relevant questions to gather location and emergency type.
- Do NOT use robotic filler phrases like "I understand", "I hear you", or "I see". Just ask the question or give the instruction.
- If the user is safe, pleasantly end the call.
- If there is an emergency, focus on getting help to them.

Image analysis:
- Use provided image details to inform your assessment naturally. Don't announce "I see the image".`
        }
      }));

      // Flush buffered audio
      if (preOpenaiBuffer.length > 0) {
        log('flushing pre-openai buffer', { chunks: preOpenaiBuffer.length, bytes: preOpenaiBufferedBytes });
        for (const chunk of preOpenaiBuffer) {
          const audioBase64 = chunk.toString('base64');
          openaiWs?.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioBase64 }));
        }
        preOpenaiBuffer = [];
        preOpenaiBufferedBytes = 0;
      }
    };

    openaiWs.onmessage = (evt: any) => {
      try {
        const data = JSON.parse(evt.data.toString());
        const eventType = data.type;

        if (eventType === 'session.created') {
          log('session created', data.session.id);
        } else if (eventType === 'response.audio_transcript.done') {
          // Capture transcript from audio-only responses
          const transcript = data.transcript ?? '';
          if (transcript) {
            pendingResponseText = transcript;
            // Add to echo cancellation buffer
            recentAgentTranscripts.push(transcript.trim().toLowerCase());
            if (recentAgentTranscripts.length > 5) recentAgentTranscripts.shift();

            log('audio transcript captured (added to echo buffer)', { transcript });
            conversationHistory.push({ role: 'assistant', content: transcript });
          }

        } else if (eventType === 'conversation.item.input_audio_transcription.completed') {
          const transcript =
            data.transcript ??
            data.text ??
            data.output_text ??
            data.transcription ??
            data?.item?.content?.[0]?.transcript ??
            '';

          // BLOCK: If agent is speaking, ignore input (prevent self-hearing)
          if (isAgentSpeaking) {
            const timeSinceSpeech = Date.now() - lastAgentSpeechTime;
            if (timeSinceSpeech < 800) {
              log('ignoring input while agent is speaking', { transcript });
              return;
            }
          }

          const cleanTranscript = (transcript || '').trim();

          // BLOCK: Echo cancellation
          const isEcho = recentAgentTranscripts.some(agentText =>
            cleanTranscript.toLowerCase().includes(agentText) ||
            agentText.includes(cleanTranscript.toLowerCase())
          );
          if (isEcho) {
            log('ignoring echo', { transcript });
            return;
          }
          // STRICT FILTER: Ignore short fragments to prevent feedback loops
          if (cleanTranscript.length > 2 && /[a-zA-Z0-9]/.test(cleanTranscript)) {
            postTimeline({ actor: 'emergency', type: 'live_caption_final', payload: { text: cleanTranscript } });
            log('transcription.completed', { text: cleanTranscript.slice(0, 120) });
            // Add to conversation history
            conversationHistory.push({ role: 'user', content: cleanTranscript });

            // AUTO-TRIGGER COORDINATOR AGENT
            setTimeout(async () => {
              try {
                await fetch(`${config.incidentBaseUrl}/incidents/${incidentId}/events`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    actor: 'realtime_gateway',
                    type: 'run_agent',
                    payload: {
                      reason: 'user_spoke',
                      transcript: transcript,
                      timestamp: new Date().toISOString()
                    },
                  }),
                });
                log('✓ triggered coordinator agent');
              } catch (err) {
                log('✗ failed to trigger agent:', err);
              }
            }, 3000); // Debounce 3s to collect multiple utterances
          } else {
            log('transcription.completed (empty)', data);
          }
        } else if (eventType === 'response.audio.delta' || eventType === 'response.output_audio.delta') {
          const audioB64 = data.audio ?? data.delta;
          if (audioB64) {
            isAgentSpeaking = true;
            lastAgentSpeechTime = Date.now();
            const buf = Buffer.from(audioB64, 'base64');
            pendingAudioChunks.push(buf);
            pendingAudioBytes += buf.length;
            if (!pendingAudioRef) pendingAudioRef = randomUUID();
            // Stream audio to browser
            try {
              ws.send(JSON.stringify({ type: 'assistant_audio_chunk', ref: pendingAudioRef, audio: audioB64, sampleRate: clientSampleRate }));
            } catch { }
            postTimeline({ actor: 'agent', type: 'agent_state', payload: { state: 'speaking' } });
            log('audio.delta', { bytes: buf.length, ref: pendingAudioRef });
          }
        } else if (eventType === 'response.audio.done' || eventType === 'response.output_audio.done') {
          pendingAudioComplete = true;
        } else if (eventType === 'response.done') {
          setTimeout(() => { isAgentSpeaking = false; }, 500);
          const text = pendingResponseText || data.response?.output_text || '';
          const durationMs = clientSampleRate > 0 ? Math.round((pendingAudioBytes / 2 / clientSampleRate) * 1000) : undefined;
          if (pendingAudioChunks.length && pendingAudioRef) {
            const audioB64 = Buffer.concat(pendingAudioChunks).toString('base64');
            try {
              ws.send(JSON.stringify({
                type: 'assistant_audio_ready',
                ref: pendingAudioRef,
                sampleRate: 24000, // OpenAI outputs at 24kHz regardless of input
                audio: audioB64,
              }));
            } catch { }
            log('audio.ready', { ref: pendingAudioRef, durationMs, bytes: pendingAudioBytes });
          }
          postTimeline({
            actor: 'agent',
            type: 'agent_message',
            payload: { text, has_audio: pendingAudioChunks.length > 0, audio_ref: pendingAudioRef || undefined, duration_ms: durationMs },
          });
          postTimeline({ actor: 'agent', type: 'agent_state', payload: { state: 'idle' } });
          pendingResponseText = '';
          pendingAudioChunks = [];
          pendingAudioComplete = false;
          pendingAudioRef = '';
          pendingAudioBytes = 0;
          responsePending = false;
        } else if (eventType === 'response.status') {
          const state = data.status;
          if (state) postTimeline({ actor: 'agent', type: 'agent_state', payload: { state } });
        } else if (eventType === 'error') {
          log('openai error', data);
        } else if (eventType.startsWith('response.')) {
          log('openai response event', eventType, data);
        } else {
          log('openai event', eventType);
        }
      } catch (err) {
        log('openai message parse error', err);
      }
    };

    openaiWs.onclose = (evt) => {
      log('openai ws closed', evt);
      responsePending = false;
      closeAll();
    };
    openaiWs.onerror = (err) => {
      log('openai ws error', err);
      responsePending = false;
      closeAll();
    };
  };

  const ensureOpenAI = () => {
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) return;
    connectOpenAI();
  };

  ws.on('message', (data, isBinary) => {
    try {
      // Control frames (client_hello) can arrive as string or Buffer (isBinary=false).
      if (!isBinary) {
        const text = typeof data === 'string' ? data : Buffer.from(data as any).toString('utf8');
        const parsed = JSON.parse(text);
        if (parsed?.type === 'client_hello' && parsed.sample_rate) {
          clientSampleRate = Number(parsed.sample_rate);
          commitThreshold = Math.ceil(clientSampleRate * 2 * 0.2);
          flushThreshold = Math.ceil(clientSampleRate * 2 * 0.1);
          log('client_hello', { sampleRate: clientSampleRate, commitThreshold, flushThreshold });
          ensureOpenAI();
        } else if (parsed?.type === 'image_upload') {
          // Handle image upload for analysis
          const { imageData, mimeType, imageUrl } = parsed;
          log('image_upload received', { mimeType, dataLength: imageData?.length });

          // Post image to timeline first
          postTimeline({
            actor: 'emergency',
            type: 'image_uploaded',
            payload: { imageUrl, mimeType }
          });

          // Analyze image with Vision API
          (async () => {
            try {
              const analysis = await analyzeImageWithVision(imageData, mimeType, conversationHistory);
              log('image analysis complete', { analysis: analysis.substring(0, 100) });

              // Post analysis to timeline
              postTimeline({
                actor: 'system',
                type: 'image_analyzed',
                payload: { analysis, imageUrl }
              });

              // Inject analysis into conversation context for Realtime API
              if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
                const contextMessage = `[Image Analysis] The user has uploaded an image. Analysis: ${analysis}`;
                openaiWs.send(JSON.stringify({
                  type: 'conversation.item.create',
                  item: {
                    type: 'message',
                    role: 'user',
                    content: [{
                      type: 'input_text',
                      text: contextMessage
                    }]
                  }
                }));

                // Trigger AI response
                scheduleResponseCreate();
              }
            } catch (err) {
              log('image analysis error', err);
            }
          })();
        }
        return;
      }

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
      if (!buf.length || buf.length < 200) return;

      // Buffer audio until OpenAI is ready so we don't lose the first seconds.
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || !openaiReady) {
        if (preOpenaiBufferedBytes + buf.length <= MAX_PREOPENAI_BYTES) {
          preOpenaiBuffer.push(buf);
          preOpenaiBufferedBytes += buf.length;
        }
        return;
      }

      const audioBase64 = buf.toString('base64');
      openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioBase64 }));
      pendingBytes += buf.length;
      log('append', { len: buf.length, pending: pendingBytes, threshold: commitThreshold });
      if (pendingBytes >= commitThreshold) {
        openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        log('commit', { bytes: pendingBytes });
        pendingBytes = 0;
        scheduleResponseCreate();
        if (pendingCommitTimer) {
          clearTimeout(pendingCommitTimer);
          pendingCommitTimer = null;
        }
      } else {
        if (pendingCommitTimer) clearTimeout(pendingCommitTimer);
        pendingCommitTimer = setTimeout(() => {
          if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || !openaiReady) return;
          if (pendingBytes >= flushThreshold) {
            openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            log('commit (timer)', { bytes: pendingBytes });
            pendingBytes = 0;
            scheduleResponseCreate();
          }
        }, 250);
      }
    } catch (err) {
      log('forward audio error', err);
    }
  });

  ws.on('close', () => {
    if (pendingBytes >= flushThreshold && openaiWs && openaiWs.readyState === WebSocket.OPEN && openaiReady) {
      openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      log('commit (close)', pendingBytes, 'bytes');
      pendingBytes = 0;
      scheduleResponseCreate();
    } else {
      pendingBytes = 0;
    }
    if (pendingCommitTimer) {
      clearTimeout(pendingCommitTimer);
      pendingCommitTimer = null;
    }
    responsePending = false;
  });
});

log(`Realtime gateway listening on ws://localhost:${config.gatewayPort}`);
