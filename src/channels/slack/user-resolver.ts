/**
 * Map Slack user IDs to aperture user IDs.
 * For MVP, this is a 1:1 mapping (Slack user ID = aperture user ID).
 * Future: configurable mapping table.
 */
export class SlackUserResolver {
  /** Resolve a Slack user ID to an aperture user ID */
  resolve(slackUserId: string): string {
    // MVP: use Slack user ID directly
    return slackUserId;
  }
}
