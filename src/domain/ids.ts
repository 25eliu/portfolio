/** Generate a fresh unique id. Centralized so it can be stubbed in tests if needed. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Today's date as an ISO calendar date (YYYY-MM-DD), UTC. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
