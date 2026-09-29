import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as chatApi from '../../api/chatApi';

export const useStartChat = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: chatApi.startChat,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chats', 'my'] });
    },
  });
};

export const useMyChats = ({ page = 1, limit = 20, status } = {}, options = {}) => {
  return useQuery({
    queryKey: ['chats', 'my', { page, limit, status }],
    queryFn: () => chatApi.getMyChats({ page, limit, status }),
    ...options,
  });
};

export const useChatDetails = (chatId, options = {}) => {
  return useQuery({
    queryKey: ['chats', chatId],
    queryFn: () => chatApi.getChatDetails(chatId),
    enabled: !!chatId,
    ...options,
  });
};

export const useChatMessages = (chatId, options = {}) => {
  return useInfiniteQuery({
    queryKey: ['chats', chatId, 'messages'],
    queryFn: ({ pageParam = 1 }) =>
      chatApi.getChatMessages({ chatId, page: pageParam, limit: 50 }),
    getNextPageParam: (lastPage) => {
      const pagination = lastPage.data?.pagination;
      if (!pagination) return undefined;

      const hasMore = pagination.page < pagination.totalPages;
      return hasMore ? pagination.page + 1 : undefined;
    },
    enabled: !!chatId,
    ...options,
  });
};

export const useSendMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: chatApi.sendMessage,
    // PERF-OPT 2: Optimistic update - show message immediately before server confirms
    onMutate: async (variables) => {
      const { chatId, content, attachments } = variables;

      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['chats', chatId, 'messages'] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData(['chats', chatId, 'messages']);

      // Create optimistic message object with already-uploaded attachments
      const optimisticMessage = {
        _id: `optimistic-${Date.now()}`,
        content,
        attachments: attachments || [],
        senderRole: 'customer',
        sender: {
          _id: 'current-user',
          firstName: 'You',
          role: 'customer',
        },
        messageType: attachments && attachments.length > 0 ? 'image' : 'text',
        createdAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
        isRead: false,
        isPending: true,
      };

      // Update the messages cache with optimistic message
      queryClient.setQueryData(['chats', chatId, 'messages'], (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page, idx) => {
            if (idx === 0) {
              return {
                ...page,
                data: {
                  ...page.data,
                  messages: [...(page.data?.messages || []), optimisticMessage],
                },
              };
            }
            return page;
          }),
        };
      });

      return { previousData, optimisticMessage };
    },
    onSuccess: (data, variables, context) => {
      const { chatId } = variables;
      // Server confirmed the message - update optimistic message with real data from DB
      // This ensures any blob URLs are replaced with real Cloudinary URLs
      queryClient.setQueryData(['chats', chatId, 'messages'], (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page, idx) => {
            if (idx === 0) {
              return {
                ...page,
                data: {
                  ...page.data,
                  messages: page.data.messages.map((msg) =>
                    msg._id === context.optimisticMessage._id
                      ? { 
                          ...data.data.message, 
                          isPending: false,
                          // Ensure attachments use real URLs, clearing any blob markers
                          attachments: (data.data.message.attachments || []).map(att => ({
                            ...att,
                            _localBlobUrl: undefined, // Clear blob marker
                            _uploadStatus: 'complete',
                          }))
                        }
                      : msg
                  ),
                },
              };
            }
            return page;
          }),
        };
      });

      // Invalidate other queries to refresh chat lists
      queryClient.invalidateQueries({ queryKey: ['chats', 'my'] });
      queryClient.invalidateQueries({ queryKey: ['chats', 'admin', 'all'] });
    },
    onError: (error, variables, context) => {
      // Rollback to previous data on error
      if (context?.previousData) {
        queryClient.setQueryData(['chats', variables.chatId, 'messages'], context.previousData);
      }
    },
  });
};

export const useMarkMessagesRead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: chatApi.markMessagesAsRead,
    onSuccess: (data, chatId) => {
      // Read receipts do not change message content. Avoid a full conversation
      // refetch on every incoming message; socket events keep the UI current.
      queryClient.invalidateQueries({ queryKey: ['chats', chatId], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['chats', 'my'], refetchType: 'none' });
    },
  });
};

export const useCloseChat = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: chatApi.closeChat,
    onSuccess: (data, chatId) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
};

export const useAllChats = ({ page = 1, limit = 20, status, priority, sortBy } = {}, options = {}) => {
  return useQuery({
    queryKey: ['chats', 'admin', 'all', { page, limit, status, priority, sortBy }],
    queryFn: () => chatApi.getAllChats({ page, limit, status, priority, sortBy }),
    ...options,
  });
};

export const useWaitingQueue = (options = {}) => {
  return useQuery({
    queryKey: ['chats', 'admin', 'queue'],
    queryFn: chatApi.getWaitingQueue,
    refetchInterval: 10000, // Auto-refetch every 10 seconds
    ...options,
  });
};

export const useResolveChat = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: chatApi.resolveChat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
};

export const useChatStats = (options = {}) => {
  return useQuery({
    queryKey: ['chats', 'admin', 'stats'],
    queryFn: chatApi.getChatStats,
    refetchInterval: 30000, // Auto-refetch every 30 seconds
    ...options,
  });
};

export const useToggleBot = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: chatApi.toggleBot,
    onSuccess: (data, variables) => {
      const { chatId } = variables;
      queryClient.invalidateQueries({ queryKey: ['chats', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats', 'my'] });
      queryClient.invalidateQueries({ queryKey: ['chats', 'admin', 'all'] });
    },
  });
};
