/**
 * Incident state machine
 */
export enum IncidentState {
    CREATED = 'CREATED',
    ASSESSING = 'ASSESSING',
    DISPATCH_REQUESTED = 'DISPATCH_REQUESTED',
    DISPATCH_CONFIRMED = 'DISPATCH_CONFIRMED',
    BED_CHECK_REQUESTED = 'BED_CHECK_REQUESTED',
    BED_CONFIRMED = 'BED_CONFIRMED',
    GUARDIAN_NOTIFIED = 'GUARDIAN_NOTIFIED',
    HANDOFF_IN_PROGRESS = 'HANDOFF_IN_PROGRESS',
    CLOSED = 'CLOSED',
}

/**
 * Actor types in the system
 */
export type Actor = 'system' | 'hospital' | 'ambulance' | 'guardian' | 'command' | 'emergency';

/**
 * Console target types
 */
export type ConsoleTarget = 'hospital' | 'ambulance' | 'guardian' | 'command' | 'emergency';

/**
 * Timeline event types
 */
export type TimelineEventType =
    | 'incident_created'
    | 'state_changed'
    | 'hospital_response'
    | 'ambulance_response'
    | 'guardian_response'
    | 'message_sent'
    | 'system_event';

/**
 * Timeline event structure
 */
export interface TimelineEvent {
    ts: string; // ISO timestamp
    actor: Actor;
    type: TimelineEventType;
    payload: Record<string, unknown>;
}

/**
 * Incident structure
 */
export interface Incident {
    id: string;
    state: IncidentState;
    created_at: string;
    updated_at: string;
    metadata: Record<string, unknown>;
    timeline: TimelineEvent[];
}

/**
 * Console message structure
 */
export interface ConsoleMessage {
    incident_id: string;
    target: ConsoleTarget;
    message: string;
    severity?: 'info' | 'warning' | 'error' | 'success';
    timestamp: string;
}

/**
 * WebSocket event types
 */
export type WsEventType =
    | 'incident_created'
    | 'incident_updated'
    | 'state_changed'
    | 'timeline_event'
    | 'console_message'
    | 'error';

/**
 * WebSocket event envelope
 */
export interface WsEvent {
    event_type: WsEventType;
    incident_id: string;
    timestamp: string;
    payload: Record<string, unknown>;
}

/**
 * Service response payload
 */
export interface ServiceResponse {
    incident_id: string;
    action: string;
    payload: Record<string, unknown>;
}

/**
 * API response wrapper
 */
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}
