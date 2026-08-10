interface ConfirmableAnalyticsEvent {
  name: string;
  properties: Record<string, string | number>;
}

export function confirmedOrderCount(events: ConfirmableAnalyticsEvent[]) {
  const requestIds = new Set<string>();
  let legacyEvents = 0;
  for (const event of events) {
    if (event.name !== "settlement_verified") continue;
    const requestId = event.properties.requestId;
    if (typeof requestId === "string" && requestId) requestIds.add(requestId);
    else legacyEvents += 1;
  }
  return requestIds.size + legacyEvents;
}
