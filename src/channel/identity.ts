import type { LifeOSConfig } from "../config.js";

/**
 * Resolve a platform user identity to a LifeOS userId.
 *
 * Lookup order:
 * 1. config.identity[channelName][platformUserId]
 * 2. config.default_user (fallback)
 *
 * Returns undefined if no mapping exists and no default is configured.
 */
export function resolveUserId(config: LifeOSConfig, channelName: string, platformUserId: string): string {
	const channelMap = config.identity[channelName];
	if (channelMap?.[platformUserId]) {
		return channelMap[platformUserId];
	}
	return config.default_user;
}
