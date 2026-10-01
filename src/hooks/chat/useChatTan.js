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
    onMutate: async (variables) => {
      const { chatId, content, attachments } = variables;
      const clientMessageId = variables.clientMessageId || crypto.randomUUID();
      variables.clientMessageId = clientMessageId;
      await queryClient.cancelQueries({ queryKey: ['chats', chatId, 'messages'] });
      const key = ['chats', chatId, 'messages'];
      const previousData = queryClient.getQueryData(key);
      const optimisticMessage = {
        _id: `optimistic-${clientMessageId}`,
        clientMessageId,
        content,
        attachments: attachments || [],
        senderRole: 'customer',
        sender: { _id: 'current-user', firstName: 'You', role: 'customer' },
        messageType: attachments?.length ? 'image' : 'text',
        createdAt: new Date().toISOString(),
        deliveredAt: null,
        isRead: false,
        isPending: true,
      };

      queryClient.setQueryData(key, (old) => {
        // A first message can be sent before the initial history GET finishes. Seed
        // the infinite-query cache so the bubble still appears immediately.
        if (!old?.pages?.length) {
          return {
            pages: [{ data: { messages: [optimisticMessage], pagination: { page: 1, totalPages: 1, hasMore: false } } }],
            pageParams: [1],
          };
        }
        const pages = [...old.pages];
        const target = pages.length - 1;
        pages[target] = {
          ...pages[target],
          data: {
            ...pages[target].data,
            messages: [...(pages[target].data?.messages || []), optimisticMessage],
          },
        };
        return { ...old, pages };
      });
      return { previousData, optimisticMessage };
    },
    onSuccess: (data, variables, context) => {
      const key = ['chats', variables.chatId, 'messages'];
      const confirmed = { ...data.data.message, isPending: false };
      queryClient.setQueryData(key, (old) => {
        if (!old?.pages?.length) return old;
        let replaced = false;
        let alreadyPresent = false;
        const pages = old.pages.map((page) => ({
          ...page,
          data: {
            ...page.data,
            messages: (page.data?.messages || []).map((msg) => {
              if (String(msg._id) === String(confirmed._id)) { alreadyPresent = true; return { ...msg, ...confirmed, isPending: false }; }
              if ((confirmed.clientMessageId && msg.clientMessageId === confirmed.clientMessageId) || (context?.optimisticMessage && msg._id === context.optimisticMessage._id)) { replaced = true; return confirmed; }
              return msg;
            }),
          },
        }));
        if (!replaced && !alreadyPresent) {
          const target = pages.length - 1;
          pages[target] = { ...pages[target], data: { ...pages[target].data, messages: [...(pages[target].data?.messages || []), confirmed] } };
        }
        return { ...old, pages };
      });
      queryClient.invalidateQueries({ queryKey: ['chats', 'my'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['chats', 'admin', 'all'], refetchType: 'none' });
    },
    onError: (error, variables, context) => {
      const key = ['chats', variables.chatId, 'messages'];
      queryClient.setQueryData(key, (old) => {
        if (!old?.pages || !context?.optimisticMessage) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: {
              ...page.data,
              messages: (page.data?.messages || []).map((msg) =>
                msg._id === context.optimisticMessage._id
                  ? { ...msg, isPending: false, isFailed: true, sendError: error?.message || 'Failed to send' }
                  : msg
              ),
            },
          })),
        };
      });
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
