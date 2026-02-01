#!/usr/bin/env node
import { runAgentForIncident, watchIncident } from './runner';

const args = process.argv.slice(2);

if (args.length === 0) {
    console.error('Usage:');
    console.error('  node agent-cli.js <incident_id>           # Run once');
    console.error('  node agent-cli.js --watch <incident_id>   # Watch for run_agent events');
    process.exit(1);
}

const isWatch = args[0] === '--watch';
const incidentId = isWatch ? args[1] : args[0];

if (!incidentId) {
    console.error('Error: incident_id required');
    process.exit(1);
}

console.log('🤖 Emergency Coordinator Agent');
console.log('================================\n');

if (isWatch) {
    console.log(`Mode: WATCH`);
    console.log(`Incident: ${incidentId}\n`);
    watchIncident(incidentId).catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
} else {
    console.log(`Mode: RUN ONCE`);
    console.log(`Incident: ${incidentId}\n`);
    runAgentForIncident(incidentId)
        .then(() => {
            console.log('\n✓ Agent completed successfully');
            process.exit(0);
        })
        .catch((err) => {
            console.error('\n✗ Agent failed:', err);
            process.exit(1);
        });
}
