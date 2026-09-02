import { describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { contactChannelName, subscribeToContactChanges } from './contact-realtime';

interface Listener {
  config: Record<string, unknown>;
  handler: () => void;
}

function makeDb() {
  const listeners: Listener[] = [];
  const channels: string[] = [];
  let subscribed = 0;
  const removed: unknown[] = [];

  const channel = {
    on: (_type: string, config: Record<string, unknown>, handler: () => void) => {
      listeners.push({ config, handler });
      return channel;
    },
    subscribe: () => {
      subscribed += 1;
      return channel;
    },
  };

  const db = {
    channel: (name: string) => {
      channels.push(name);
      return channel;
    },
    removeChannel: vi.fn((ch: unknown) => {
      removed.push(ch);
      return Promise.resolve('ok');
    }),
  };

  return {
    db: db as unknown as SupabaseClient,
    channel,
    listeners,
    channels,
    removed,
    subscribedCount: () => subscribed,
  };
}

describe('subscribeToContactChanges', () => {
  it('arma un canal por contacto con los tres filtros y se suscribe', () => {
    const { db, listeners, channels, subscribedCount } = makeDb();

    subscribeToContactChanges(db, 'c-42', () => {});

    expect(channels).toEqual([contactChannelName('c-42')]);
    expect(subscribedCount()).toBe(1);
    expect(listeners.map((l) => l.config)).toEqual([
      {
        event: 'INSERT',
        schema: 'public',
        table: 'contact_tags',
        filter: 'contact_id=eq.c-42',
      },
      {
        event: 'DELETE',
        schema: 'public',
        table: 'contact_tags',
        filter: 'contact_id=eq.c-42',
      },
      { event: 'UPDATE', schema: 'public', table: 'contacts', filter: 'id=eq.c-42' },
    ]);
  });

  it('cualquier evento dispara onChange', () => {
    const { db, listeners } = makeDb();
    const onChange = vi.fn();

    subscribeToContactChanges(db, 'c-42', onChange);
    for (const l of listeners) l.handler();

    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('la funcion devuelta saca exactamente ese canal', () => {
    const { db, channel, removed } = makeDb();

    const unsubscribe = subscribeToContactChanges(db, 'c-42', () => {});
    expect(removed).toEqual([]);

    unsubscribe();
    expect(removed).toEqual([channel]);
  });
});
