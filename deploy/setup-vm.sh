#!/usr/bin/env bash
#
# Prepares a fresh Oracle Cloud Always Free VM (Ubuntu) to run this app.
# Run once, as a normal user with sudo rights:
#
#   bash deploy/setup-vm.sh
#
# It is idempotent — running it twice is safe.
set -euo pipefail

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
log "Checking the machine"
TOTAL_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
echo "    architecture: $(uname -m)"
echo "    memory:       ${TOTAL_MB} MB"

# ---------------------------------------------------------------------------
# A 1 GB x86 micro instance runs the app fine but is routinely killed while
# building it — npm and vite together need more than it has. Swap costs nothing
# and turns an OOM kill into a slow build.
if [ "$TOTAL_MB" -lt 2048 ] && [ ! -f /swapfile ]; then
  log "Adding 2 GB of swap (small instance, the Docker build needs it)"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "    swap: not needed or already present"
fi

# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg |
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
  warn "You were added to the docker group — log out and back in before running docker without sudo."
else
  log "Docker already installed"
fi

# ---------------------------------------------------------------------------
# Oracle's Ubuntu images ship iptables rules that drop everything except SSH.
# This is the step people miss: opening the Security List in the OCI console is
# necessary but NOT sufficient, because this host firewall still blocks 80/443.
log "Opening ports 80 and 443 on the host firewall"
sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true

for port in 80 443; do
  if sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    echo "    port $port already allowed"
  else
    # Insert above the catch-all REJECT that Oracle puts at the end of INPUT.
    sudo iptables -I INPUT 6 -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT
    echo "    opened port $port"
  fi
done

sudo netfilter-persistent save >/dev/null 2>&1 ||
  warn "Could not persist iptables rules — they will be lost on reboot. Install iptables-persistent manually."

# ---------------------------------------------------------------------------
log "Done on the VM side"
cat <<'NEXT'

Still to do, and the deploy will not work until both are true:

  1. In the OCI console, open ingress for TCP 80 and 443:
     Networking > Virtual Cloud Networks > your VCN > Security Lists > default
     Add two ingress rules, source 0.0.0.0/0, destination port 80 and 443.
     (The host firewall above is a SEPARATE firewall — both must allow traffic.)

  2. Point a hostname at this machine's public IP. A free DuckDNS subdomain is
     enough, and a real hostname is required: Caddy cannot issue a certificate
     for a bare IP address, and without HTTPS the app's Secure session cookie
     is refused by every browser.

Then:

     cp deploy/.env.example deploy/.env
     nano deploy/.env            # fill in all four values
     cd deploy && docker compose up -d --build
     docker compose logs -f app  # expect: database ready / serving client / listening

NEXT
