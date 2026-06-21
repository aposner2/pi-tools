import { Bonjour } from "bonjour-service";
import type { ChatConfig } from "./types";

const SERVICE_TYPE = "pi-chat";

let bonjour: Bonjour | null = null;

// Discovered peers list for the chat panel
const discoveredPeers = new Set<string>();
const peerListeners = new Set<(peers: Set<string>) => void>();

export function getDiscoveredPeers(): Set<string> {
  return discoveredPeers;
}

export function onPeerDiscovered(callback: (peers: Set<string>) => void): void {
  peerListeners.add(callback);
}

function notifyPeerChange(): void {
  peerListeners.forEach((cb) => cb(new Set(discoveredPeers)));
}

export function startDiscovery(config: ChatConfig): void {
  if (bonjour) return;
  bonjour = new Bonjour();

  // Announce our service
  bonjour.publish({
    name: `pi-chat-${config.agentId}`,
    type: SERVICE_TYPE,
    port: config.port,
    protocol: "tcp",
    txt: { agentId: config.agentId },
  });

  // Browse for peer services
  bonjour.find({ type: SERVICE_TYPE }, (service) => {
    const label = `${service.name} @ ${service.host}:${service.port}`;
    discoveredPeers.add(label);
    notifyPeerChange();
  });
}

export function stopDiscovery(): void {
  if (bonjour) {
    bonjour.unpublishAll();
    bonjour.destroy();
    bonjour = null;
  }
}
