#!/bin/bash

# Emergency Orchestrator - Stop All Services

set -e

echo "🛑 Emergency Orchestrator - Stopping All Services"
echo "=================================================="
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Function to stop a service
stop_service() {
    local service_name=$1
    local pid_file="$SCRIPT_DIR/logs/$service_name.pid"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p $pid > /dev/null 2>&1; then
            echo -e "Stopping $service_name (PID: $pid)..."
            kill $pid
            rm -f "$pid_file"
            echo -e "${GREEN}✓ $service_name stopped${NC}"
        else
            echo -e "${RED}✗ $service_name not running${NC}"
            rm -f "$pid_file"
        fi
    else
        echo -e "${RED}✗ No PID file for $service_name${NC}"
    fi
}

# Stop all services
stop_service "Incident Service"
stop_service "Hospital Service"
stop_service "Ambulance Service"
stop_service "Guardian Service"
stop_service "Realtime Gateway"
stop_service "Agent Daemon"

echo ""
echo "=================================================="
echo -e "${GREEN}All services stopped${NC}"
