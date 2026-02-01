import { Incident, TimelineEvent, IncidentState } from '@emergency-orchestrator/shared';

/**
 * In-memory incident store
 * Clean interface for easy database swap later
 */
export class IncidentStore {
    private incidents: Map<string, Incident> = new Map();

    create(incident: Incident): void {
        this.incidents.set(incident.id, incident);
    }

    get(id: string): Incident | undefined {
        return this.incidents.get(id);
    }

    update(id: string, updates: Partial<Incident>): Incident | undefined {
        const incident = this.incidents.get(id);
        if (!incident) return undefined;

        const updated = {
            ...incident,
            ...updates,
            updated_at: new Date().toISOString(),
        };
        this.incidents.set(id, updated);
        return updated;
    }

    appendTimeline(id: string, event: TimelineEvent): Incident | undefined {
        const incident = this.incidents.get(id);
        if (!incident) return undefined;

        incident.timeline.push(event);
        incident.updated_at = new Date().toISOString();
        this.incidents.set(id, incident);
        return incident;
    }

    updateState(id: string, state: IncidentState): Incident | undefined {
        const incident = this.incidents.get(id);
        if (!incident) return undefined;

        incident.state = state;
        incident.updated_at = new Date().toISOString();
        this.incidents.set(id, incident);
        return incident;
    }

    list(): Incident[] {
        return Array.from(this.incidents.values());
    }
}
