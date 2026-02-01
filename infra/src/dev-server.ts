import { execSync } from 'child_process';

const printBanner = () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║          🚨 EMERGENCY ORCHESTRATOR - DEV MODE 🚨           ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('Starting all services...\n');
    console.log('  🚨  Incident     → http://localhost:4001');
    console.log('  🏥  Hospital     → http://localhost:4002');
    console.log('  🚑  Ambulance    → http://localhost:4003');
    console.log('  👨‍👩‍👧  Guardian     → http://localhost:4004');
    console.log('\n────────────────────────────────────────────────────────────\n');
    console.log('WebSocket endpoint:');
    console.log('  📡 Incident WS     → ws://localhost:4001/ws?incident_id=INC123\n');
    console.log('────────────────────────────────────────────────────────────\n');
    console.log('Press Ctrl+C to stop all services\n');
};

printBanner();

// Use concurrently to run all services
try {
    execSync(
        'npx concurrently -n incident,hospital,ambulance,guardian -c "cyan,green,yellow,magenta" ' +
        '"cd ../services/incident && PORT=4001 npm run dev" ' +
        '"cd ../services/hospital && PORT=4002 npm run dev" ' +
        '"cd ../services/ambulance && PORT=4003 npm run dev" ' +
        '"cd ../services/guardian && PORT=4004 npm run dev"',
        {
            stdio: 'inherit',
            cwd: __dirname,
        }
    );
} catch (err) {
    // Ctrl+C will cause this, which is expected
    console.log('\n\n🛑 Services stopped\n');
}

