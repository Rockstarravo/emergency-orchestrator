export function getSuggestion(_: { audio_id?: string; attachments?: Array<{ id?: string; url?: string; name?: string }> }) {
    // Return null to prevent static hardcoded messages.
    // The real voice agent will handle the response.
    return {
        text: null,
    };
}
