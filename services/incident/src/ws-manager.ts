import { WebSocket } from 'ws';
import { WsEvent } from '@emergency-orchestrator/shared';

/**
 * WebSocket connection manager
 * Handles room-based broadcasting for incident updates
 */
export class WsManager {
    // Map of incident_id -> Set of WebSocket connections
    private rooms: Map<string, Set<WebSocket>> = new Map();

    /**
     * Subscribe a client to an incident room
     */
    subscribe(incidentId: string, ws: WebSocket): void {
        if (!this.rooms.has(incidentId)) {
            this.rooms.set(incidentId, new Set());
        }
        this.rooms.get(incidentId)!.add(ws);

        // Clean up on disconnect
        ws.on('close', () => {
            this.unsubscribe(incidentId, ws);
        });
    }

    /**
     * Unsubscribe a client from an incident room
     */
    unsubscribe(incidentId: string, ws: WebSocket): void {
        const room = this.rooms.get(incidentId);
        if (room) {
            room.delete(ws);
            if (room.size === 0) {
                this.rooms.delete(incidentId);
            }
        }
    }

    /**
     * Broadcast an event to all subscribers in an incident room
     */
    broadcast(incidentId: string, event: WsEvent): void {
        const room = this.rooms.get(incidentId);
        if (!room) return;

        const message = JSON.stringify(event);
        room.forEach((ws) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                } catch (err) {
                    // Ignore send errors (connection might have closed)
                }
            }
        });
    }

    /**
     * Get subscriber count for an incident
     */
    getSubscriberCount(incidentId: string): number {
        return this.rooms.get(incidentId)?.size ?? 0;
    }
}
