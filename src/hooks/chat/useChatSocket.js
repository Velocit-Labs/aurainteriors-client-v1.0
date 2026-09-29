import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * useChatSocket
 *
 * Manages all real-time socket events for a chat session.
 *
 * FIX 1: Typing indicator is now event-driven (ai:thinking_start / ai:thinking_stop /
 *         ai:error) — NOT a client-side setTimeout. A 10-second safety timer shows a
 *         "still working…" message if the AI hasn't responded yet.
 *
 * FIX 2: Listens for ai:token / ai:complete events and builds a `streamingMessage`
 *         state that the UI renders progressively, giving a streaming text effect.
 */
const useChatSocket = (socket, chatId) => {
  const queryClient = useQueryClient();

  // Human or AI typing indicator state
  const [typingStatus, setTypingStatus] = useState({ isTyping: false, userRole: null });

  // FIX 2: Token-by-token streaming message buffer
  const [streamingMessage, setStreamingMessage] = useState('');

  // FIX 1: True when AI has been thinking for > 10 seconds without a response
  const [aiStillWorking, setAiStillWorking] = useState(false);

  // Refs for cleanup
  const humanTypingTimeoutRef = useRef(null); // fallback timer for human typing only
  const aiStillWorkingTimerRef = useRef(null); // 10s safety timer for AI

  // Join / leave chat room
  useEffect(() => {
    if (!socket || !chatId) return;

    const roomChatId = chatId.toString();
    socket.emit('chat:join', { chatId: roomChatId });

    return () => {
      socket.emit('chat:leave', { chatId: roomChatId });
    };
  }, [socket, chatId]);

  // Socket event listeners
  useEffect(() => {
    if (!socket || !chatId) return;

    // ----- Standard message events -----

    const handleNewMessage = (data) => {
      if (data?.chatId?.toString() !== chatId?.toString() || !data?.message) return;
      setStreamingMessage('');

      // Socket payload is already the canonical populated DB message. Merge it into
      // React Query instead of downloading the entire conversation again.
      queryClient.setQueryData(['chats', chatId, 'messages'], (old) => {
        if (!old?.pages?.length) return old;
        const incoming = data.message;
        let found = false;
        const pages = old.pages.map((page) => ({
          ...page,
          data: {
            ...page.data,
            messages: (page.data?.messages || []).map((m) => {
              if (m._id === incoming._id) { found = true; return incoming; }
              return m;
            }),
          },
        }));
        if (!found) {
          const last = pages.length - 1;
          const list = pages[last].data?.messages || [];
          // If the socket beats the POST response, replace the matching optimistic
          // customer bubble rather than briefly rendering a duplicate.
          const optimisticIndex = incoming.senderRole === 'customer'
            ? list.findIndex((m) => String(m._id).startsWith('optimistic-') && m.content === incoming.content)
            : -1;
          const next = [...list];
          if (optimisticIndex >= 0) next[optimisticIndex] = incoming;
          else next.push(incoming);
          pages[last] = { ...pages[last], data: { ...pages[last].data, messages: next } };
        }
        return { ...old, pages };
      });

      // Lists are secondary UI; mark stale without forcing the open conversation to refetch.
      queryClient.invalidateQueries({ queryKey: ['chats', 'my'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['chats', 'admin', 'all'], refetchType: 'none' });
    };

    const handleMessagesRead = (data) => {
      if (data.chatId === chatId) {
        queryClient.invalidateQueries({ queryKey: ['chats', chatId, 'messages'] });
        queryClient.invalidateQueries({ queryKey: ['chats', chatId] });
        queryClient.invalidateQueries({ queryKey: ['chats', 'my'] });
        queryClient.invalidateQueries({ queryKey: ['chats', 'admin', 'all'] });
      }
    };

    const handleChatClosed = (data) => {
      if (data.chatId === chatId) queryClient.invalidateQueries({ queryKey: ['chats'] });
    };

    const handleChatResolved = (data) => {
      if (data.chatId === chatId) queryClient.invalidateQueries({ queryKey: ['chats'] });
    };

    const handleStatusChanged = (data) => {
      if (data.chatId === chatId) {
        queryClient.invalidateQueries({ queryKey: ['chats'] });
        queryClient.invalidateQueries({ queryKey: ['chats', 'my'] });
        queryClient.invalidateQueries({ queryKey: ['chats', 'admin', 'all'] });
      }
    };

    // ----- Human typing indicator (existing, with a short fallback timer) -----

    const handleTypingStatus = (data) => {
      if (data.chatId?.toString() !== chatId?.toString()) return;

      // Only handle human typing here — AI typing is managed by ai:thinking_start/stop
      if (data.userRole === 'ai') return;

      setTypingStatus({ isTyping: data.isTyping, userRole: data.userRole });

      if (data.isTyping) {
        if (humanTypingTimeoutRef.current) clearTimeout(humanTypingTimeoutRef.current);
        // Short fallback: if the human typing stop event is somehow missed, clear after 5s
        humanTypingTimeoutRef.current = setTimeout(() => {
          setTypingStatus({ isTyping: false, userRole: null });
        }, 5000);
      } else {
        if (humanTypingTimeoutRef.current) clearTimeout(humanTypingTimeoutRef.current);
      }
    };

    // ----- FIX 1: AI thinking indicator — event-driven, no timer -----

    const handleAiThinkingStart = (data) => {
      if (data.chatId?.toString() !== chatId?.toString()) return;

      setTypingStatus({ isTyping: true, userRole: 'ai' });
      setStreamingMessage('');
      setAiStillWorking(false);

      // 10-second safety: if we haven't gotten a response yet, show a softer label
      if (aiStillWorkingTimerRef.current) clearTimeout(aiStillWorkingTimerRef.current);
      aiStillWorkingTimerRef.current = setTimeout(() => {
        setAiStillWorking(true);
      }, 10000);
    };

    const handleAiThinkingStop = (data) => {
      if (data.chatId?.toString() !== chatId?.toString()) return;

      setTypingStatus({ isTyping: false, userRole: null });
      setAiStillWorking(false);
      if (aiStillWorkingTimerRef.current) clearTimeout(aiStillWorkingTimerRef.current);
    };

    const handleAiError = (data) => {
      if (data.chatId?.toString() !== chatId?.toString()) return;

      // Always clear indicator on error so it's never stuck
      setTypingStatus({ isTyping: false, userRole: null });
      setStreamingMessage('');
      setAiStillWorking(false);
      if (aiStillWorkingTimerRef.current) clearTimeout(aiStillWorkingTimerRef.current);
    };

    // ----- FIX 2: Streaming token accumulation -----

    const handleAiToken = (data) => {
      if (data.chatId?.toString() !== chatId?.toString()) return;
      setStreamingMessage((prev) => prev + data.token);
    };

    const handleAiComplete = (data) => {
      if (data.chatId?.toString() !== chatId?.toString()) return;

      // Give the DB message time to arrive via handleNewMessage before clearing buffer
      setTimeout(() => setStreamingMessage(''), 400);
      setTypingStatus({ isTyping: false, userRole: null });
      setAiStillWorking(false);
      if (aiStillWorkingTimerRef.current) clearTimeout(aiStillWorkingTimerRef.current);
    };

    // Register all listeners
    socket.on('chat:message:new', handleNewMessage);
    socket.on('chat:typing:status', handleTypingStatus);
    socket.on('chat:messages:read', handleMessagesRead);
    socket.on('chat:closed', handleChatClosed);
    socket.on('chat:resolved', handleChatResolved);
    socket.on('chat:status:changed', handleStatusChanged);
    socket.on('ai:thinking_start', handleAiThinkingStart);
    socket.on('ai:thinking_stop', handleAiThinkingStop);
    socket.on('ai:error', handleAiError);
    socket.on('ai:token', handleAiToken);
    socket.on('ai:complete', handleAiComplete);

    return () => {
      socket.off('chat:message:new', handleNewMessage);
      socket.off('chat:typing:status', handleTypingStatus);
      socket.off('chat:messages:read', handleMessagesRead);
      socket.off('chat:closed', handleChatClosed);
      socket.off('chat:resolved', handleChatResolved);
      socket.off('chat:status:changed', handleStatusChanged);
      socket.off('ai:thinking_start', handleAiThinkingStart);
      socket.off('ai:thinking_stop', handleAiThinkingStop);
      socket.off('ai:error', handleAiError);
      socket.off('ai:token', handleAiToken);
      socket.off('ai:complete', handleAiComplete);

      if (humanTypingTimeoutRef.current) clearTimeout(humanTypingTimeoutRef.current);
      if (aiStillWorkingTimerRef.current) clearTimeout(aiStillWorkingTimerRef.current);
    };
  }, [socket, chatId, queryClient]);

  // Outgoing helpers

  const broadcastMessage = useCallback(
    (message) => {
      if (socket && chatId) socket.emit('chat:message', { chatId, message });
    },
    [socket, chatId]
  );

  const sendTypingIndicator = useCallback(
    (isTyping) => {
      if (socket && chatId) socket.emit('chat:typing', { chatId, isTyping });
    },
    [socket, chatId]
  );

  const broadcastRead = useCallback(() => {
    if (socket && chatId) socket.emit('chat:read', { chatId });
  }, [socket, chatId]);

  const broadcastChatClose = useCallback(() => {
    if (socket && chatId) socket.emit('chat:close', { chatId });
  }, [socket, chatId]);

  return {
    typingStatus,
    streamingMessage,
    aiStillWorking,
    broadcastMessage,
    sendTypingIndicator,
    broadcastRead,
    broadcastChatClose,
  };
};

export default useChatSocket;
