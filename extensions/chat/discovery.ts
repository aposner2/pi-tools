import { Bonjour } from "bonjour-service";
import type { ChatConfig } from "./types";

const SERVICE_TYPE = "pi-chat";

let bonjour: Bonjour | null = null;

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
    console.log(`[pi-chat] discovered peer: ${service.name} at ${service.host}:${service.port}`);
  });
}

export function stopDiscovery(): void {
  if (bonjour) {
    bonjour.unpublishAll();
    bonjour.destroy();
    bonjour = null;
  }
}
