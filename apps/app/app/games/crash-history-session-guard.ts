export type CrashHistoryRequestTicket = {
  generation: number;
  signal: AbortSignal;
};

type CrashHistoryRequestChannel = 'history' | 'receipt';

export class CrashHistorySessionGuard {
  #generation = 0;
  readonly #requests = new Map<CrashHistoryRequestChannel, AbortController>();

  begin(channel: CrashHistoryRequestChannel): CrashHistoryRequestTicket {
    this.#requests.get(channel)?.abort();
    const controller = new AbortController();
    this.#requests.set(channel, controller);
    return { generation: this.#generation, signal: controller.signal };
  }

  isCurrent(ticket: CrashHistoryRequestTicket): boolean {
    return !ticket.signal.aborted && ticket.generation === this.#generation;
  }

  switchSession(): void {
    this.#generation += 1;
    for (const controller of this.#requests.values()) controller.abort();
    this.#requests.clear();
  }
}
