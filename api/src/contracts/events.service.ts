import { Injectable, type MessageEvent } from '@nestjs/common';
import { Subject, filter, interval, map, merge, type Observable } from 'rxjs';

// Events only say what to reload; the page then fetches it through the normal, filtered endpoints.
export type ContractEvent = 'contract' | 'document' | 'lock' | 'comments' | 'chat';

interface Published {
  contractId: string;
  type: ContractEvent;
  // Undefined means both sides.
  partyId?: string;
}

// In memory, so this assumes a single API process.
@Injectable()
export class EventsService {
  private readonly events = new Subject<Published>();

  publish(contractId: string, type: ContractEvent, partyId?: string): void {
    this.events.next({ contractId, type, partyId });
  }

  stream(contractId: string, partyId: string): Observable<MessageEvent> {
    const own = this.events.pipe(
      filter((event) => event.contractId === contractId && (event.partyId === undefined || event.partyId === partyId)),
      map((event): MessageEvent => ({ data: { type: event.type } })),
    );
    // Keeps proxies from closing an idle connection.
    const ping = interval(25_000).pipe(map((): MessageEvent => ({ data: { type: 'ping' } })));
    return merge(own, ping);
  }
}
