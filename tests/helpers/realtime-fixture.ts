import type { BrowserContext, WebSocketRoute } from "@playwright/test";

type Message = { topic: string; event: string; payload: Record<string, unknown>; ref?: string; join_ref?: string };
type Binding = { id: number; table: string; filter?: string; event: string; schema: string };
type Channel = { key: string; ref?: string; meta?: { lot_id: string; phx_ref: string }; bindings: Binding[] };

// Protocol fixture, not a replacement Supabase client. Browser tests run the
// installed SDK's join/track/untrack/rejoin and presence-state machinery.
// Hosted Supabase heartbeat expiry, RLS delivery and load still need staging.
export class RealtimeFixture {
  private sockets = new Map<WebSocketRoute, Map<string, Channel>>();
  private sequence = 0;
  private arrayProtocol = new Map<WebSocketRoute, boolean>();

  async attach(context: BrowserContext) {
    await context.routeWebSocket(/\/realtime\/v1\/websocket/, socket => {
      this.sockets.set(socket, new Map());
      socket.onMessage(data => {
        const raw = JSON.parse(data.toString());
        this.arrayProtocol.set(socket, Array.isArray(raw));
        const message: Message = Array.isArray(raw)
          ? { join_ref: raw[0], ref: raw[1], topic: raw[2], event: raw[3], payload: raw[4] }
          : raw;
        this.receive(socket, message);
      });
      socket.onClose(() => { this.sockets.delete(socket); this.syncPresence(); });
    });
  }

  private send(socket: WebSocketRoute, message: Message) {
    socket.send(JSON.stringify(this.arrayProtocol.get(socket)
      ? [message.join_ref ?? null, message.ref ?? null, message.topic, message.event, message.payload]
      : message));
  }
  private receive(socket: WebSocketRoute, message: Message) {
    const channels = this.sockets.get(socket)!;
    const reply = (response: Record<string, unknown> = {}) => this.send(socket, {
      ...message, event: 'phx_reply', payload: { status: 'ok', response },
    });
    if (message.event === 'phx_join') {
      const config = message.payload.config as { presence?: { key?: string }; postgres_changes?: Omit<Binding, 'id'>[] };
      const bindings = (config.postgres_changes ?? []).map(binding => ({ ...binding, id: ++this.sequence }));
      channels.set(message.topic, { key: config.presence?.key ?? `untracked-${++this.sequence}`, ref: message.ref, bindings });
      reply({ postgres_changes: bindings });
      this.syncPresence();
    } else if (message.event === 'presence') {
      const channel = channels.get(message.topic);
      if (channel) channel.meta = message.payload.event === 'track'
        ? { ...(message.payload.payload as { lot_id: string }), phx_ref: String(++this.sequence) }
        : undefined;
      reply(); this.syncPresence();
    } else if (message.event === 'phx_leave') {
      channels.delete(message.topic); reply(); this.syncPresence();
    } else { reply(); }
  }

  private syncPresence() {
    const topic = 'realtime:auction-live-audience';
    const state: Record<string, { metas: { lot_id: string; phx_ref: string }[] }> = {};
    for (const channels of this.sockets.values()) {
      const channel = channels.get(topic);
      if (channel?.meta) {
        state[channel.key] ??= { metas: [] };
        state[channel.key].metas.push(channel.meta);
      }
    }
    for (const [socket, channels] of this.sockets) {
      const channel = channels.get(topic);
      if (channel) this.send(socket, { topic, event: 'presence_state', payload: state, join_ref: channel.ref });
    }
  }

  emit(table: string, record: Record<string, unknown> = {}) {
    for (const [socket, channels] of this.sockets) {
      for (const [topic, channel] of channels) {
        const ids = channel.bindings.filter(binding => {
          if (binding.table !== table) return false;
          if (!binding.filter) return true;
          const [column, value] = binding.filter.split('=eq.');
          return String(record[column]) === value;
        })
          .map(binding => binding.id);
        if (ids.length) this.send(socket, { topic, event: 'postgres_changes', join_ref: channel.ref, payload: {
          ids, data: { schema: 'public', table, type: 'UPDATE', commit_timestamp: new Date().toISOString(), columns: [], record, old_record: {}, errors: null },
        } });
      }
    }
  }

  disconnect() {
    const sockets = [...this.sockets.keys()];
    this.sockets.clear();
    for (const socket of sockets) socket.close({ code: 1012, reason: 'Test reconnect' });
  }
}
