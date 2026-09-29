import { useEffect } from 'react';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import {
  Plus,
  Headset,
  Package,
  Sofa,
  ArrowRight,
} from "lucide-react";
import Skeleton, { ChatMessageSkeleton } from '../common/Skeleton';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatMessages, useMarkMessagesRead, useSendMessage } from '../../hooks/chat/useChatTan';
import useChatSocket from '../../hooks/chat/useChatSocket';
import useNotificationSocket from '../../hooks/notification/useNotificationSocket';
import useAuthStore from '../../store/authStore';
import { getGuestSessionId } from '../../utils/guestSessionStorage';
import ChatMessageList from './ChatMessageList';
import ChatInput from './ChatInput';

const ChatWindow = ({ chat, onClose, onStartNew, onResetView, isCreatingChat }) => {
  const { user } = useAuthStore();
  const token = localStorage.getItem('token');
  const guestSessionId = getGuestSessionId();
  const { socket } = useNotificationSocket(token, user?._id, guestSessionId);

  const {
    data: messagesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useChatMessages(chat?._id, { enabled: !!chat });

  const markAsReadMutation = useMarkMessagesRead();
  const sendMessageMutation = useSendMessage();
  const { typingStatus, streamingMessage, aiStillWorking, sendTypingIndicator, broadcastRead } = useChatSocket(socket, chat?._id);

  // Derived message list — must be declared before any useEffect that depends on its length
  const allMessages = messagesData?.pages.flatMap((page) => page.data.messages) || [];
  const messageCount = allMessages.length;

  // CHAT-FIXES-8 Fix 1: Continuous read tracking.
  // Fire markAsRead whenever new messages arrive while the tab is focused.
  useEffect(() => {
    if (!chat?._id) return;
    const markReadIfVisible = () => {
      if (document.visibilityState === 'visible') {
        markAsReadMutation.mutate(chat._id);
        broadcastRead();
      }
    };
    markReadIfVisible();
    document.addEventListener('visibilitychange', markReadIfVisible);
    return () => document.removeEventListener('visibilitychange', markReadIfVisible);
  }, [messageCount, chat?._id]);

  useEffect(() => {
    if (chat?._id && chat?.unreadCountCustomer > 0) {
      markAsReadMutation.mutate(chat._id);
      broadcastRead();
    }
  }, [chat?._id]);

  return (
    <div className="flex flex-col h-full bg-white font-dm-sans overflow-hidden">
      {/* Refined Professional Header - No Gradients */}
      {/* Minimalist Header */}
      <div className="shrink-0 bg-white border-b border-gray-100 p-3 sm:p-4 shadow-sm relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#F9F8F6] flex items-center justify-center text-[#F27318]">
              {/* Using a Robot icon or similar if available, else standard Shield/Headset */}
              <Headset size={18} sm:size={20} strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-gray-900 font-semibold text-[15px] sm:text-base tracking-tight leading-none">Aura Assistant</h3>
              <p className="text-[10px] sm:text-[13px] text-gray-500 mt-0.5">Expert help for your home</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onResetView}
              className="text-sm font-semibold text-[#1A1714] hover:text-[#F27318] flex items-center gap-1 transition-colors"
            >
              <Plus size={16} /> New Chat
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-gray-50/30">
        {chat ? (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-hidden relative">
              {isLoading ? (
                <div className="p-4 space-y-4">
                  <ChatMessageSkeleton isUser={false} />
                  <ChatMessageSkeleton isUser={true} />
                </div>
              ) : (
                <ChatMessageList
                  messages={allMessages}
                  isLoading={isLoading}
                  onLoadMore={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
                  hasMore={hasNextPage}
                  isFetchingMore={isFetchingNextPage}
                  currentUserId={user?._id}
                  streamingMessage={streamingMessage}
                  typingStatus={typingStatus}
                  aiStillWorking={aiStillWorking}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="h-full relative bg-white">
            {isCreatingChat ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-4">
                <Skeleton className="w-12 h-12 rounded-full" />
                <Skeleton className="w-48 h-5 rounded" />
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col justify-between bg-gray-50/30">
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <div className="w-40 h-40 flex items-center justify-center overflow-hidden">
                    <DotLottieReact
                      src="/ai-anim.lottie"
                      loop
                      autoplay
                      className="w-full h-full"
                    />
                  </div>

                  <h2 className="text-[#1A1714] text-lg sm:text-xl font-black tracking-tight leading-tight max-w-[280px]">
                    Hi{user?.firstName ? ` ${user.firstName}` : ''} 👋, I'm here to help.
                  </h2>
                  <p className="text-gray-500 text-xs sm:text-sm mt-2 max-w-[260px] leading-normal">
                    Ask me anything about our products, orders, or policies.
                  </p>
                </div>

                <div className="relative z-10 flex flex-col">
                  {/* Suggestions */}
                  <div className="px-10 pb-5 mb-6">
                    <h4 className="mb-4 pt-10 text-[15px] font-semibold text-gray-900">
                      Suggested questions
                    </h4>

                    <div className="space-y-3">
                      {[
                        {
                          title: "Track my order",
                          icon: Package,
                        },
                        {
                          title: "Product recommendations",
                          icon: Sofa,
                        },
                      ].map((item) => {
                        const Icon = item.icon;

                        return (
                          <button
                            key={item.title}
                            onClick={() => onStartNew(item.title)}
                            className="group flex w-full items-center justify-between rounded-xl px-2 py-3 transition-all duration-200 hover:bg-[#FFF8F3]/80"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#F27318]/10 transition-colors duration-200 group-hover:bg-[#F27318]">
                                <Icon className="h-5 w-5 text-[#F27318] transition-colors duration-200 group-hover:text-white" />
                              </div>

                              <div className="text-left">
                                <p className="text-[15px] font-semibold text-gray-900 group-hover:text-[#F27318]">
                                  {item.title}
                                </p>

                                <p className="text-[13px] text-gray-500">
                                  {item.title === "Track my order"
                                    ? "Check your delivery status"
                                    : "Discover beautiful furniture"}
                                </p>
                              </div>
                            </div>

                            <ArrowRight className="h-4 w-4 text-gray-300 transition-all duration-200 group-hover:translate-x-1 group-hover:text-[#F27318]" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="border-t border-gray-200 bg-white py-4 shadow-[0_-8px_24px_rgba(0,0,0,0.04)] rounded-b-2xl">
                    <button
                      onClick={() => onStartNew()}
                      className="flex w-full items-center justify-center py-2 text-sm font-medium text-gray-500 transition-colors hover:text-[#F27318]"
                    >
                      Start a blank conversation
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 bg-white">


        {chat && ['ai_handling', 'escalated', 'agent_handling'].includes(chat.status) && (
          <ChatInput
            chatId={chat._id}
            onTyping={(isTyping) => sendTypingIndicator(isTyping)}
          />
        )}
      </div>
    </div>
  );
};

export default ChatWindow;