# Test Scripts

Automated test suite for Emergency Orchestrator Phase-1 backend.

## Prerequisites

- All services must be running:
  - Incident Service: http://localhost:4001
  - Hospital Service: http://localhost:4002
  - Ambulance Service: http://localhost:4003
  - Guardian Service: http://localhost:4004

## Installation

```bash
cd scripts
npm install
```

## Running Tests

### Option 1: Using tsx (recommended)

```bash
cd scripts
npm test
```

Or directly:

```bash
tsx test-phase1.ts
```

### Option 2: From root directory

```bash
# Make sure services are running first
npm run dev

# In another terminal
cd scripts
npm test
```

## Test Coverage

The test suite validates:

### A) Incident Creation
- ✅ POST /incidents returns incident_id
- ✅ GET /incidents/:id returns incident object
- ✅ Initial state is CREATED
- ✅ Timeline array exists

### B) WebSocket Subscription
- ✅ Connection opens successfully
- ✅ Initial event received
- ✅ Event has event_type and incident_id
- ✅ incident_id matches

### C) Timeline Append
- ✅ POST timeline event succeeds
- ✅ WebSocket receives new event
- ✅ GET shows new timeline entry

### D) State Update
- ✅ POST state update succeeds
- ✅ WebSocket receives state change event
- ✅ GET shows updated state

### E) Responder Services
- ✅ Hospital /respond succeeds
- ✅ Ambulance /respond succeeds
- ✅ Guardian /respond succeeds
- ✅ Timeline contains events with correct actors
- ✅ WebSocket receives service response events

### F) Negative Cases
- ✅ GET invalid incident returns 404
- ✅ POST invalid state returns 400
- ✅ POST responder without incident_id returns 400

## Output

The test runner produces:

1. **Real-time progress**: Shows each test as it runs with ✅/❌
2. **Summary report**: Total passed/failed counts
3. **Failure details**: Expected vs actual values for failed tests
4. **WebSocket events**: Last 5 events received for debugging
5. **Exit code**: 0 for success, 1 for failures

## Example Output

```
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     🧪 EMERGENCY ORCHESTRATOR - PHASE 1 TEST SUITE 🧪      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

🧪 Test A: Incident Creation
  ✅ POST /incidents returns incident_id: INC12345678
  ✅ GET /incidents/:id returns incident object
  ✅ Initial state is CREATED
  ✅ Incident has timeline array

🧪 Test B: WebSocket Subscription
  📡 WebSocket connected for incident INC12345678
  ✅ WebSocket connection opens successfully
  ✅ WebSocket receives initial event (1 events so far)
  ✅ WS event has event_type: incident_updated
  ✅ WS event has correct incident_id

...

════════════════════════════════════════════════════════════
📊 TEST REPORT
════════════════════════════════════════════════════════════

✅ Passed: 25
❌ Failed: 0

📡 Last 5 WebSocket Events:
────────────────────────────────────────────────────────────

1. state_changed
   Incident: INC12345678
   Timestamp: 2026-02-01T05:33:42.000Z
   Payload: {"state":"ASSESSING","incident":{...}}...

...

════════════════════════════════════════════════════════════
FINAL RESULT: ✅ ALL TESTS PASSED
════════════════════════════════════════════════════════════
```

## Troubleshooting

### Services not running

```
Error: fetch failed
```

**Solution**: Start all services first:
```bash
cd /Users/ravindramacbookpro/Developer/emergency-orchestrator
npm run dev
```

### WebSocket connection timeout

```
Error: WebSocket connection timeout
```

**Solution**: Ensure Incident Service is running on port 4001 and WebSocket endpoint is accessible.

### Port conflicts

If services fail to start, check for port conflicts:
```bash
lsof -i :4001
lsof -i :4002
lsof -i :4003
lsof -i :4004
```
