/**
 * DingTalk peer ID registry.
 *
 * DingTalk conversationIds are Base64-encoded and case-sensitive,
 * but downstream code may lowercase them. This registry preserves
 * the original case by mapping lowercased → original.
 */
const registry = new Map<string, string>();

export function registerPeerId(id: string): void {
  registry.set(id.toLowerCase(), id);
}

export function resolveOriginalPeerId(id: string): string {
  return registry.get(id.toLowerCase()) || id;
}
