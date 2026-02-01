#!/usr/bin/env node
import { startDaemon } from './daemon.js';

const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('No incident IDs provided. Starting in Auto-Discovery Mode.');
}

console.log('🤖 Emergency Coordinator Agent - DAEMON MODE');
console.log('============================================\n');
console.log(`Watching ${args.length} incident(s):\n`);
args.forEach((id, i) => console.log(`  ${i + 1}. ${id}`));
console.log('');

startDaemon(args).catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
