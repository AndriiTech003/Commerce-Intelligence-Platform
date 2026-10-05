'use client';

import { useEffect, useRef, useState } from 'react';
import { api, unwrap } from './api';
import { backoffDelay } from './backoff';

export type ChannelStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface LiveHandlers {
  onTick: (tick: TickMessage) => void;
  onEvent: (item: FeedMessage['item']) => void;
  onResync: () => void;
}

export interface TickMessage {
  type: 'tick';
  ts: number;
  eventsPerSec: number;
  byType: Record<string, number>;
  activeVisitors: number;
  revenueTodayCents: number;
  ordersToday: number;
}

export interface FeedMessage {
  type: 'event';
  item: {
    eventId: string;
    eventType: string;
    occurredAt: string;
    country: string | null;
    label: string;
    productId: string | null;
    revenueCents: number | null;
  };
}

export function useLiveChannel(tenantId: string | null, handlers: LiveHandlers): ChannelStatus {
  const [status, setStatus] = useState<ChannelStatus>('connecting');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!tenantId) return;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let lastMessage = Date.now();

    const scheduleReconnect = () => {
      if (closed) return;
      setStatus(attempt > 4 ? 'offline' : 'reconnecting');
      retryTimer = setTimeout(connect, backoffDelay(attempt++));
    };

    const connect = async () => {
      if (closed) return;
      try {
        const ticket = unwrap(await api.POST('/v1/admin/realtime/ticket'));
        socket = new WebSocket(`${ticket.url}?ticket=${encodeURIComponent(ticket.ticket)}`);
      } catch {
        scheduleReconnect();
        return;
      }
      const ws = socket;
      ws.onopen = () => {
        attempt = 0;
        lastMessage = Date.now();
        setStatus('live');
        handlersRef.current.onResync();
        if (document.visibilityState === 'hidden') ws.send(JSON.stringify({ type: 'pause' }));
      };
      ws.onmessage = (message) => {
        lastMessage = Date.now();
        try {
          const data = JSON.parse(String(message.data)) as { type: string };
          if (data.type === 'tick') handlersRef.current.onTick(data as TickMessage);
          if (data.type === 'event') handlersRef.current.onEvent((data as FeedMessage).item);
        } catch {
          return;
        }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    };

    const onVisibility = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (document.visibilityState === 'hidden') socket.send(JSON.stringify({ type: 'pause' }));
      else {
        socket.send(JSON.stringify({ type: 'resume' }));
        handlersRef.current.onResync();
      }
    };

    pingTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
        if (Date.now() - lastMessage > 35_000) socket.close();
      }
    }, 15_000);

    document.addEventListener('visibilitychange', onVisibility);
    setStatus('connecting');
    void connect();
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      socket?.close();
    };
  }, [tenantId]);

  return status;
}
