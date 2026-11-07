import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConnectionState, type FeedEvent, LiveConnection, type LiveSocket } from '../src/index.js';

class FakeSocket implements LiveSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: never) => unknown) | null = null;
  onmessage: ((event: { data: unknown }) => unknown) | null = null;
  onclose: ((event: { code?: number }) => unknown) | null = null;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }

  open() {
    this.readyState = 1;
    this.onopen?.(undefined as never);
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const event = (seq: number) => ({ seq, id: String(seq) }) as FeedEvent;

function setup(isOffline?: () => boolean) {
  const sockets: FakeSocket[] = [];
  const states: ConnectionState[] = [];
  const events: number[] = [];
  const onAccessChanged = vi.fn();
  const connection = new LiveConnection({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    isOffline,
    onState: (state) => states.push(state),
    onEvent: (e) => events.push(e.seq),
    onAccessChanged,
  });
  return { connection, sockets, states, events, onAccessChanged };
}

describe('live connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('states where it left off, and goes live only when the server is ready', () => {
    const { connection, sockets, states } = setup();
    expect(connection.start(42)).toBe(true);
    expect(connection.start(99)).toBe(false);
    sockets[0]?.open();
    expect(JSON.parse(sockets[0]?.sent[0] as string)).toEqual({ type: 'hello', lastSeq: 42 });
    expect(states).toEqual([]);
    sockets[0]?.receive({ type: 'ready', headSeq: 42 });
    expect(states).toEqual(['live']);
  });

  it('delivers each event once, ignoring repeats and anything older', () => {
    const { connection, sockets, events } = setup();
    connection.start(10);
    sockets[0]?.open();
    for (const seq of [9, 10, 11, 11, 12, 11]) sockets[0]?.receive({ type: 'event', event: event(seq) });
    expect(events).toEqual([11, 12]);
  });

  it('after a drop it reconnects with backoff, resuming from the last event it holds', () => {
    const { connection, sockets, states } = setup();
    connection.start(5);
    sockets[0]?.open();
    sockets[0]?.receive({ type: 'event', event: event(7) });
    sockets[0]?.drop();
    expect(states).toContain('reconnecting');
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1100);
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    expect(JSON.parse(sockets[1]?.sent[0] as string)).toEqual({ type: 'hello', lastSeq: 7 });
  });

  it('backs off further with each failure, up to a limit', () => {
    const { connection, sockets } = setup();
    connection.start(0);
    for (let i = 0; i < 8; i += 1) {
      const socket = sockets[sockets.length - 1] as FakeSocket;
      socket.drop();
      vi.advanceTimersByTime(30_000);
    }
    expect(sockets.length).toBe(9);
    const before = sockets.length;
    (sockets[sockets.length - 1] as FakeSocket).drop();
    vi.advanceTimersByTime(14_000);
    expect(sockets.length).toBe(before);
    vi.advanceTimersByTime(16_100);
    expect(sockets.length).toBe(before + 1);
  });

  it('says offline when the platform knows it is', () => {
    const { connection, sockets, states } = setup(() => true);
    connection.start(0);
    sockets[0]?.drop();
    expect(states).toEqual(['offline']);
  });

  it('stops for good when access changes, and tells the app', () => {
    for (const code of [4401, 4403]) {
      const { connection, sockets, onAccessChanged } = setup();
      connection.start(0);
      sockets[0]?.open();
      sockets[0]?.drop(code);
      expect(onAccessChanged).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(120_000);
      connection.wake();
      expect(sockets).toHaveLength(1);
    }
  });

  it('coming back online reconnects at once, without waiting out the backoff', () => {
    const { connection, sockets } = setup();
    connection.start(3);
    sockets[0]?.drop();
    connection.wake();
    expect(sockets).toHaveLength(2);
  });

  it('coming back when the socket survived does not open a second one', () => {
    const { connection, sockets, states } = setup();
    connection.start(3);
    sockets[0]?.open();
    sockets[0]?.receive({ type: 'ready', headSeq: 3 });
    connection.markOffline();
    connection.wake();
    expect(sockets).toHaveLength(1);
    expect(states[states.length - 1]).toBe('live');
    expect(JSON.parse(sockets[0]?.sent[sockets[0].sent.length - 1] as string)).toEqual({ type: 'ping' });
  });

  it('a socket that stops answering pings is replaced', () => {
    const { connection, sockets } = setup();
    connection.start(0);
    sockets[0]?.open();
    vi.advanceTimersByTime(25_000);
    expect(JSON.parse(sockets[0]?.sent[sockets[0].sent.length - 1] as string)).toEqual({ type: 'ping' });
    vi.advanceTimersByTime(25_000);
    expect(sockets[0]?.readyState).toBe(3);
    vi.advanceTimersByTime(1100);
    expect(sockets).toHaveLength(2);
  });

  it('stopping closes the socket and ends all retries', () => {
    const { connection, sockets } = setup();
    connection.start(0);
    sockets[0]?.open();
    connection.stop();
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
  });
});
