import WebSocket from 'ws';

// ============================================================================
// Configuration
// ============================================================================

const SERVICES = {
    incident: 'http://localhost:4001',
    hospital: 'http://localhost:4002',
    ambulance: 'http://localhost:4003',
    guardian: 'http://localhost:4004',
};

const WS_BASE = 'ws://localhost:4001';

// ============================================================================
// Test State
// ============================================================================

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    expected?: unknown;
    actual?: unknown;
}

const results: TestResult[] = [];
const wsEvents: any[] = [];
let incidentId = '';

// ============================================================================
// Utilities
// ============================================================================

function pass(name: string): void {
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
}

function fail(name: string, error: string, expected?: unknown, actual?: unknown): void {
    results.push({ name, passed: false, error, expected, actual });
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error}`);
    if (expected !== undefined) console.log(`     Expected: ${JSON.stringify(expected)}`);
    if (actual !== undefined) console.log(`     Actual: ${JSON.stringify(actual)}`);
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpRequest(url: string, options: RequestInit = {}): Promise<any> {
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }

    return {
        status: response.status,
        ok: response.ok,
        data,
    };
}

function connectWebSocket(incidentId: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${WS_BASE}/ws?incident_id=${incidentId}`);

        ws.on('open', () => {
            console.log(`  📡 WebSocket connected for incident ${incidentId}`);
            resolve(ws);
        });

        ws.on('message', (data) => {
            try {
                const event = JSON.parse(data.toString());
                wsEvents.push(event);
                console.log(`  📨 WS Event: ${event.event_type}`);
            } catch (err) {
                console.log(`  ⚠️  WS Message parse error: ${err}`);
            }
        });

        ws.on('error', (err) => {
            console.log(`  ⚠️  WS Error: ${err.message}`);
            reject(err);
        });

        ws.on('close', () => {
            console.log(`  📡 WebSocket closed`);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket connection timeout'));
            }
        }, 5000);
    });
}

// ============================================================================
// Test Scenarios
// ============================================================================

async function testIncidentCreation(): Promise<void> {
    console.log('\n🧪 Test A: Incident Creation');

    try {
        // Create incident
        const createRes = await httpRequest(`${SERVICES.incident}/incidents`, {
            method: 'POST',
            body: JSON.stringify({
                metadata: {
                    location: 'Test Location',
                    severity: 'high',
                    test: true,
                },
            }),
        });

        if (!createRes.ok) {
            fail('POST /incidents returns 201', `Got status ${createRes.status}`, 201, createRes.status);
            return;
        }

        if (!createRes.data?.success) {
            fail('POST /incidents returns success=true', 'Response success is false', true, createRes.data?.success);
            return;
        }

        if (!createRes.data?.data?.id || typeof createRes.data.data.id !== 'string') {
            fail('POST /incidents returns incident_id', 'Missing or invalid incident ID', 'string', typeof createRes.data?.data?.id);
            return;
        }

        incidentId = createRes.data.data.id;
        pass(`POST /incidents returns incident_id: ${incidentId}`);

        // Verify incident exists
        const getRes = await httpRequest(`${SERVICES.incident}/incidents/${incidentId}`);

        if (!getRes.ok) {
            fail('GET /incidents/:id returns 200', `Got status ${getRes.status}`, 200, getRes.status);
            return;
        }

        if (getRes.data?.data?.id !== incidentId) {
            fail('GET /incidents/:id returns correct incident', 'ID mismatch', incidentId, getRes.data?.data?.id);
            return;
        }

        pass('GET /incidents/:id returns incident object');

        if (getRes.data?.data?.state !== 'CREATED') {
            fail('Initial state is CREATED', 'Wrong initial state', 'CREATED', getRes.data?.data?.state);
            return;
        }

        pass('Initial state is CREATED');

        if (!Array.isArray(getRes.data?.data?.timeline)) {
            fail('Incident has timeline array', 'Timeline is not an array', 'array', typeof getRes.data?.data?.timeline);
            return;
        }

        pass('Incident has timeline array');

    } catch (err: any) {
        fail('Incident creation', err.message);
    }
}

async function testWebSocketSubscription(ws: WebSocket): Promise<void> {
    console.log('\n🧪 Test B: WebSocket Subscription');

    try {
        if (ws.readyState !== WebSocket.OPEN) {
            fail('WebSocket connection opens', 'Connection not open', WebSocket.OPEN, ws.readyState);
            return;
        }

        pass('WebSocket connection opens successfully');

        // Wait for initial event
        await sleep(500);

        if (wsEvents.length === 0) {
            fail('WebSocket receives initial event', 'No events received', '>0', 0);
            return;
        }

        pass(`WebSocket receives initial event (${wsEvents.length} events so far)`);

        const firstEvent = wsEvents[0];
        if (!firstEvent.event_type) {
            fail('WS event has event_type', 'Missing event_type', 'string', undefined);
            return;
        }

        pass(`WS event has event_type: ${firstEvent.event_type}`);

        if (firstEvent.incident_id !== incidentId) {
            fail('WS event has correct incident_id', 'ID mismatch', incidentId, firstEvent.incident_id);
            return;
        }

        pass('WS event has correct incident_id');

    } catch (err: any) {
        fail('WebSocket subscription', err.message);
    }
}

async function testTimelineAppend(): Promise<void> {
    console.log('\n🧪 Test C: Timeline Append');

    try {
        const eventsBefore = wsEvents.length;

        // Try /incidents/:id/events first (as per implementation)
        let endpoint = `${SERVICES.incident}/incidents/${incidentId}/events`;
        let res = await httpRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify({
                actor: 'system',
                type: 'system_event',
                payload: {
                    message: 'Test timeline event',
                    test: true,
                },
            }),
        });

        // If 404, try /timeline
        if (res.status === 404) {
            endpoint = `${SERVICES.incident}/incidents/${incidentId}/timeline`;
            res = await httpRequest(endpoint, {
                method: 'POST',
                body: JSON.stringify({
                    actor: 'system',
                    type: 'system_event',
                    payload: {
                        message: 'Test timeline event',
                        test: true,
                    },
                }),
            });
        }

        console.log(`  📍 Using endpoint: ${endpoint}`);

        if (!res.ok) {
            fail('POST timeline event returns success', `Got status ${res.status}`, 200, res.status);
            return;
        }

        pass('POST timeline event succeeds');

        // Wait for WS event
        await sleep(300);

        if (wsEvents.length <= eventsBefore) {
            fail('WebSocket receives timeline event', 'No new WS events', `>${eventsBefore}`, wsEvents.length);
            return;
        }

        pass('WebSocket receives new event after timeline append');

        // Verify timeline in GET
        const getRes = await httpRequest(`${SERVICES.incident}/incidents/${incidentId}`);
        const timeline = getRes.data?.data?.timeline;

        if (!Array.isArray(timeline)) {
            fail('GET shows timeline', 'Timeline not found', 'array', typeof timeline);
            return;
        }

        const testEvent = timeline.find((e: any) => e.payload?.test === true);
        if (!testEvent) {
            fail('Timeline contains new event', 'Event not found in timeline', 'event with test=true', 'not found');
            return;
        }

        pass('Timeline contains new event');

    } catch (err: any) {
        fail('Timeline append', err.message);
    }
}

async function testStateUpdate(): Promise<void> {
    console.log('\n🧪 Test D: State Update');

    try {
        const eventsBefore = wsEvents.length;

        const res = await httpRequest(`${SERVICES.incident}/incidents/${incidentId}/state`, {
            method: 'POST',
            body: JSON.stringify({
                state: 'ASSESSING',
            }),
        });

        if (!res.ok) {
            fail('POST state update returns success', `Got status ${res.status}`, 200, res.status);
            return;
        }

        pass('POST state update succeeds');

        // Wait for WS event
        await sleep(300);

        if (wsEvents.length <= eventsBefore) {
            fail('WebSocket receives state change event', 'No new WS events', `>${eventsBefore}`, wsEvents.length);
            return;
        }

        pass('WebSocket receives state change event');

        // Verify state in GET
        const getRes = await httpRequest(`${SERVICES.incident}/incidents/${incidentId}`);
        const state = getRes.data?.data?.state;

        if (state !== 'ASSESSING') {
            fail('GET shows updated state', 'State not updated', 'ASSESSING', state);
            return;
        }

        pass('GET shows updated state: ASSESSING');

        // Check for state_changed event in WS
        const stateChangeEvent = wsEvents.find((e: any) => e.event_type === 'state_changed');
        if (stateChangeEvent) {
            pass('WS event_type is state_changed');
        }

    } catch (err: any) {
        fail('State update', err.message);
    }
}

async function testResponderServices(): Promise<void> {
    console.log('\n🧪 Test E: Responder Services');

    // Test Hospital
    try {
        const eventsBefore = wsEvents.length;

        const res = await httpRequest(`${SERVICES.hospital}/respond`, {
            method: 'POST',
            body: JSON.stringify({
                incident_id: incidentId,
                action: 'bed_confirmed',
                payload: {
                    beds_available: 3,
                    department: 'emergency',
                },
            }),
        });

        if (!res.ok) {
            fail('Hospital /respond returns success', `Got status ${res.status}`, 200, res.status);
        } else {
            pass('Hospital /respond succeeds');

            // Wait for WS event
            await sleep(300);

            if (wsEvents.length > eventsBefore) {
                pass('WebSocket receives hospital response event');
            }

            // Verify timeline
            const getRes = await httpRequest(`${SERVICES.incident}/incidents/${incidentId}`);
            const timeline = getRes.data?.data?.timeline;
            const hospitalEvent = timeline?.find((e: any) => e.actor === 'hospital');

            if (hospitalEvent) {
                pass('Timeline contains hospital event with actor=hospital');
            } else {
                fail('Timeline contains hospital event', 'Hospital event not found', 'actor=hospital', 'not found');
            }
        }
    } catch (err: any) {
        fail('Hospital responder', err.message);
    }

    // Test Ambulance
    try {
        const eventsBefore = wsEvents.length;

        const res = await httpRequest(`${SERVICES.ambulance}/respond`, {
            method: 'POST',
            body: JSON.stringify({
                incident_id: incidentId,
                action: 'dispatch_confirmed',
                payload: {
                    eta_minutes: 10,
                    unit_id: 'AMB-TEST-1',
                },
            }),
        });

        if (!res.ok) {
            fail('Ambulance /respond returns success', `Got status ${res.status}`, 200, res.status);
        } else {
            pass('Ambulance /respond succeeds');

            // Wait for WS event
            await sleep(300);

            if (wsEvents.length > eventsBefore) {
                pass('WebSocket receives ambulance response event');
            }

            // Verify timeline
            const getRes = await httpRequest(`${SERVICES.incident}/incidents/${incidentId}`);
            const timeline = getRes.data?.data?.timeline;
            const ambulanceEvent = timeline?.find((e: any) => e.actor === 'ambulance');

            if (ambulanceEvent) {
                pass('Timeline contains ambulance event with actor=ambulance');
            } else {
                fail('Timeline contains ambulance event', 'Ambulance event not found', 'actor=ambulance', 'not found');
            }
        }
    } catch (err: any) {
        fail('Ambulance responder', err.message);
    }

    // Test Guardian
    try {
        const eventsBefore = wsEvents.length;

        const res = await httpRequest(`${SERVICES.guardian}/respond`, {
            method: 'POST',
            body: JSON.stringify({
                incident_id: incidentId,
                action: 'acknowledged',
                payload: {
                    contact: 'Test Guardian',
                    phone: '555-0100',
                },
            }),
        });

        if (!res.ok) {
            fail('Guardian /respond returns success', `Got status ${res.status}`, 200, res.status);
        } else {
            pass('Guardian /respond succeeds');

            // Wait for WS event
            await sleep(300);

            if (wsEvents.length > eventsBefore) {
                pass('WebSocket receives guardian response event');
            }

            // Verify timeline
            const getRes = await httpRequest(`${SERVICES.incident}/incidents/${incidentId}`);
            const timeline = getRes.data?.data?.timeline;
            const guardianEvent = timeline?.find((e: any) => e.actor === 'guardian');

            if (guardianEvent) {
                pass('Timeline contains guardian event with actor=guardian');
            } else {
                fail('Timeline contains guardian event', 'Guardian event not found', 'actor=guardian', 'not found');
            }
        }
    } catch (err: any) {
        fail('Guardian responder', err.message);
    }
}

async function testNegativeCases(): Promise<void> {
    console.log('\n🧪 Test F: Negative Cases');

    // Test invalid incident ID
    try {
        const res = await httpRequest(`${SERVICES.incident}/incidents/INVALID_ID`);

        if (res.status === 404) {
            pass('GET invalid incident returns 404');
        } else {
            fail('GET invalid incident returns 404', `Got status ${res.status}`, 404, res.status);
        }
    } catch (err: any) {
        fail('GET invalid incident', err.message);
    }

    // Test invalid state
    try {
        const res = await httpRequest(`${SERVICES.incident}/incidents/${incidentId}/state`, {
            method: 'POST',
            body: JSON.stringify({
                state: 'INVALID_STATE',
            }),
        });

        if (res.status === 400) {
            pass('POST invalid state returns 400');
        } else {
            fail('POST invalid state returns 400', `Got status ${res.status}`, 400, res.status);
        }
    } catch (err: any) {
        fail('POST invalid state', err.message);
    }

    // Test missing incident_id in responder
    try {
        const res = await httpRequest(`${SERVICES.hospital}/respond`, {
            method: 'POST',
            body: JSON.stringify({
                action: 'test',
                payload: {},
            }),
        });

        if (res.status === 400) {
            pass('POST responder without incident_id returns 400');
        } else {
            fail('POST responder without incident_id returns 400', `Got status ${res.status}`, 400, res.status);
        }
    } catch (err: any) {
        fail('POST responder without incident_id', err.message);
    }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main(): Promise<void> {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║     🧪 EMERGENCY ORCHESTRATOR - PHASE 1 TEST SUITE 🧪      ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    let ws: WebSocket | null = null;

    try {
        // Test A: Incident Creation
        await testIncidentCreation();

        if (!incidentId) {
            console.log('\n❌ Cannot continue tests without incident_id');
            return;
        }

        // Test B: WebSocket Subscription
        ws = await connectWebSocket(incidentId);
        await testWebSocketSubscription(ws);

        // Test C: Timeline Append
        await testTimelineAppend();

        // Test D: State Update
        await testStateUpdate();

        // Test E: Responder Services
        await testResponderServices();

        // Test F: Negative Cases
        await testNegativeCases();

    } catch (err: any) {
        console.log(`\n💥 Fatal error: ${err.message}`);
    } finally {
        // Close WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    }

    // Print Report
    console.log('\n' + '═'.repeat(60));
    console.log('📊 TEST REPORT');
    console.log('═'.repeat(60) + '\n');

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}\n`);

    if (failed > 0) {
        console.log('Failed Tests:');
        console.log('─'.repeat(60));
        results
            .filter((r) => !r.passed)
            .forEach((r) => {
                console.log(`\n❌ ${r.name}`);
                console.log(`   Error: ${r.error}`);
                if (r.expected !== undefined) console.log(`   Expected: ${JSON.stringify(r.expected)}`);
                if (r.actual !== undefined) console.log(`   Actual: ${JSON.stringify(r.actual)}`);
            });
        console.log('\n' + '─'.repeat(60));
    }

    // Print last 5 WS events
    console.log('\n📡 Last 5 WebSocket Events:');
    console.log('─'.repeat(60));
    const lastEvents = wsEvents.slice(-5);
    if (lastEvents.length === 0) {
        console.log('  (No events received)');
    } else {
        lastEvents.forEach((event, idx) => {
            console.log(`\n${idx + 1}. ${event.event_type}`);
            console.log(`   Incident: ${event.incident_id}`);
            console.log(`   Timestamp: ${event.timestamp}`);
            console.log(`   Payload: ${JSON.stringify(event.payload, null, 2).substring(0, 200)}...`);
        });
    }
    console.log('\n' + '─'.repeat(60));

    console.log('\n' + '═'.repeat(60));
    console.log(`FINAL RESULT: ${failed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
    console.log('═'.repeat(60) + '\n');

    // Exit with appropriate code
    process.exit(failed === 0 ? 0 : 1);
}

main();
