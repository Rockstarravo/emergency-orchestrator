#!/bin/bash

# Emergency Orchestrator - Start All Services
# This script starts all backend services and the AI coordinator agent daemon

set -e

echo "🚨 Emergency Orchestrator - Starting All Services"
echo "=================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Function to start a service in the background
start_service() {
    local service_name=$1
    local service_dir=$2
    local port=$3
    
    echo -e "${BLUE}Starting $service_name on port $port...${NC}"
    cd "$SCRIPT_DIR/$service_dir"
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies for $service_name...${NC}"
        npm install
    fi
    
    # Start the service
    npm start > "$SCRIPT_DIR/logs/$service_name.log" 2>&1 &
    echo $! > "$SCRIPT_DIR/logs/$service_name.pid"
    
    echo -e "${GREEN}✓ $service_name started (PID: $(cat $SCRIPT_DIR/logs/$service_name.pid))${NC}"
    echo ""
}

# Create logs directory
mkdir -p "$SCRIPT_DIR/logs"

# Clean up old PIDs
rm -f "$SCRIPT_DIR/logs"/*.pid

echo "Starting backend services..."
echo ""

# Start Incident Service
start_service "Incident Service" "services/incident" "4001"
sleep 2

# Start Hospital Service
start_service "Hospital Service" "services/hospital" "4002"
sleep 1

# Start Ambulance Service
start_service "Ambulance Service" "services/ambulance" "4003"
sleep 1

# Start Guardian Service
start_service "Guardian Service" "services/guardian" "4004"
sleep 1

# Start Realtime Gateway
echo -e "${BLUE}Starting Realtime Gateway on port 4010...${NC}"
cd "$SCRIPT_DIR/agent"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies for Realtime Gateway...${NC}"
    npm install
fi
npm run dev:gateway > "$SCRIPT_DIR/logs/realtime-gateway.log" 2>&1 &
echo $! > "$SCRIPT_DIR/logs/realtime-gateway.pid"
echo -e "${GREEN}✓ Realtime Gateway started (PID: $(cat $SCRIPT_DIR/logs/realtime-gateway.pid))${NC}"
echo ""
sleep 2

# Start AI Coordinator Agent Daemon
echo -e "${BLUE}Starting AI Coordinator Agent Daemon...${NC}"
cd "$SCRIPT_DIR/agent"

# The daemon will watch for run_agent events triggered by the realtime gateway
# You can also pass specific incident IDs as arguments to this script
echo -e "${YELLOW}Agent daemon will respond to run_agent events from realtime gateway${NC}"

# Start daemon - it will process run_agent events from any incident
npm run daemon > "$SCRIPT_DIR/logs/agent-daemon.log" 2>&1 &
echo $! > "$SCRIPT_DIR/logs/agent-daemon.pid"
echo -e "${GREEN}✓ Agent Daemon started (PID: $(cat $SCRIPT_DIR/logs/agent-daemon.pid))${NC}"
echo -e "${YELLOW}Note: Daemon processes run_agent events triggered by voice interactions${NC}"
echo ""

echo ""
echo "=================================================="
echo -e "${GREEN}All services started successfully!${NC}"
echo ""
echo "Services running:"
echo "  • Incident Service:    http://localhost:4001"
echo "  • Hospital Service:    http://localhost:4002"
echo "  • Ambulance Service:   http://localhost:4003"
echo "  • Guardian Service:    http://localhost:4004"
echo "  • Realtime Gateway:    ws://localhost:4010"
echo ""
echo "Logs are available in: $SCRIPT_DIR/logs/"
echo ""
echo "To stop all services, run: ./stop-all.sh"
echo "To view logs: tail -f logs/<service-name>.log"
echo ""
echo "🎉 Ready for emergency coordination!"
