import { useRef, useEffect, useState } from 'react';
import { Loader2, MessageCircle, Sparkles, ChevronDown, User, Bot } from 'lucide-react';
import { ChatMessageSkeleton } from '../common/Skeleton';
import ChatMessage from './ChatMessage';
import useAuthStore from '../../store/authStore';
import { getAvatarUrl } from '../../utils/imageUrl';


const ChatMessageList = ({
  messages,
  isLoading,
  onLoadMore,
  hasMore,
  isFetchingMore,
  currentUserId,
  isAdminView = false,
  typingStatus,
}) => {
  const { user } = useAuthStore();
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const prevScrollHeightRef = useRef(0);

  // FIX 1: Scroll-position tracking (using refs to avoid re-renders on every scroll tick)
  const isNearBottomRef = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const prevContentCountRef = useRef(0);


  // FIX 1: Auto-scroll only when near bottom OR on first load
  const isFirstLoadRef = useRef(true);
  const prevFirstMessageIdRef = useRef(null);

  useEffect(() => {
    const firstMsgId = messages[0]?._id;
    if (firstMsgId !== prevFirstMessageIdRef.current) {
      isFirstLoadRef.current = true;
      prevFirstMessageIdRef.current = firstMsgId;
    }
  }, [messages]);

  useEffect(() => {
    const currentCount = messages.length;
    const prevCount = prevContentCountRef.current;
    const isNewContent = currentCount > prevCount;

    if (!isFetchingMore && isNewContent) {
      if (isFirstLoadRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        isFirstLoadRef.current = false;
        setHasNewMessages(false);
      } else if (isNearBottomRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setHasNewMessages(false);
      } else {
        // User is scrolled up — show the pill instead of forcing scroll
        setHasNewMessages(true);
      }
    }

    prevContentCountRef.current = currentCount;
  }, [messages.length, isFetchingMore]);

  useEffect(() => {
    if (typingStatus?.isTyping && isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [typingStatus?.isTyping]);

  // Handle infinite scroll (load older messages) + track scroll position
  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // FIX 1: Track whether user is near the bottom (threshold: 100px)
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distFromBottom < 100;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setHasNewMessages(false);

    // Infinite scroll — load older messages when reaching the top
    if (container.scrollTop === 0 && hasMore && !isFetchingMore) {
      prevScrollHeightRef.current = container.scrollHeight;
      onLoadMore();
    }
  };

  // Maintain scroll position after loading older messages
  useEffect(() => {
    if (isFetchingMore && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const scrollHeightDiff = container.scrollHeight - prevScrollHeightRef.current;
      container.scrollTop = scrollHeightDiff;
    }
  }, [isFetchingMore, messages.length]);

  // One progress indicator per AI turn. This is status only; AI content is never
  // rendered token-by-token. The canonical persisted response still appears once.
  const showTypingBubble = typingStatus?.isTyping && (
    (isAdminView && typingStatus.userRole === "customer") ||
    (!isAdminView && ["admin", "ai"].includes(typingStatus.userRole))
  );

  if (isLoading) {
    return (
      <div className="p-4 space-y-4 h-full">
        <ChatMessageSkeleton isUser={false} />
        <ChatMessageSkeleton isUser={true} />
        <ChatMessageSkeleton isUser={false} />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 p-6">
        <div className="w-20 h-20 rounded-2xl bg-linear-to-br from-teal-100 to-teal-50 flex items-center justify-center mb-4 shadow-sm">
          <MessageCircle className="w-10 h-10 text-teal-600" />
        </div>
        <p className="text-neutral-700 font-semibold text-base">Start a conversation</p>
        <p className="text-sm text-neutral-400 mt-1.5 text-center max-w-60">
          Send us a message and we'll get back to you as soon as possible
        </p>
        <div className="flex items-center gap-1.5 mt-4 text-xs text-teal-600 bg-teal-50 px-3 py-1.5 rounded-full">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Usually replies within minutes</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={messagesContainerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto pt-6 space-y-4"
    >
      {/* Load More Indicator */}
      {isFetchingMore && (
        <div className="flex justify-center py-3">
          <div className="flex items-center gap-2 text-sm text-neutral-500 bg-white px-4 py-2 rounded-full shadow-sm border border-neutral-100">
            <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
            <span>Loading earlier messages...</span>
          </div>
        </div>
      )}

      {/* Has More Indicator */}
      {hasMore && !isFetchingMore && (
        <div className="flex justify-center py-2">
          <button
            onClick={onLoadMore}
            className="text-xs text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-full transition-colors"
          >
            Load earlier messages
          </button>
        </div>
      )}

      {/* Messages */}
      {messages.map((message) => {
        const messageSenderId = message.sender?._id || message.sender;
        const isOwnMessage =
          (messageSenderId && currentUserId && messageSenderId.toString() === currentUserId.toString()) ||
          (user?.role === "admin" ? message.senderRole === "admin" : message.senderRole === "customer");

        return (
          <ChatMessage
            key={message._id}
            message={message}
            isOwnMessage={isOwnMessage}
            isAdminView={isAdminView}
          />
        );
      })}

      {showTypingBubble && (() => {
        const isAiTyping = typingStatus.userRole === 'ai';
        const matchedMsg = messages.find(m => m.senderRole === typingStatus.userRole);
        const userObj = matchedMsg?.sender;
        const isGuest = userObj?.firstName === "Guest" && userObj?.lastName === "User";
        
        return (
          <div className="flex w-full mb-3 px-4 justify-start animate-fade-in">
            <div className="flex max-w-full gap-3 flex-row items-center">
              {/* Avatar */}
              {isAiTyping ? (
                <div className="w-8 h-8 rounded-full bg-slate-800 text-teal-400 border border-slate-700 flex items-center justify-center shrink-0">
                  <Bot size={16} />
                </div>
              ) : isGuest ? (
                <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 text-gray-500 flex items-center justify-center shrink-0">
                  <User size={14} strokeWidth={1.5} />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center border shadow-xs shrink-0 overflow-hidden bg-gray-50 border-gray-100">
                  <img
                    src={getAvatarUrl(userObj)}
                    alt={typingStatus.userRole === 'admin' ? "Admin" : userObj?.firstName || "User"}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        typingStatus.userRole === 'admin' ? "Admin" : userObj?.firstName || "U"
                      )}&background=${typingStatus.userRole === 'admin' ? 'E0E7FF' : 'F3F4F6'}&color=${typingStatus.userRole === 'admin' ? '4338CA' : '9CA3AF'}`;
                    }}
                  />
                </div>
              )}
              {/* Bubble */}
              <div className="bg-gray-100 px-4 py-2.5 rounded-2xl flex gap-1 items-center justify-center w-fit">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '600ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms', animationDuration: '600ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms', animationDuration: '600ms' }} />
              </div>
            </div>
          </div>
        );
      })()}

      <div ref={messagesEndRef} />

      {/* FIX 1: "New message" pill — shown when new messages arrive while user is scrolled up */}
      {hasNewMessages && (
        <div className="sticky bottom-3 flex justify-center pointer-events-none">
          <button
            onClick={() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              setHasNewMessages(false);
            }}
            className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 bg-[#F27318] text-white text-[11px] font-bold rounded-full shadow-lg hover:bg-[#D9620E] transition-colors animate-bounce"
          >
            <ChevronDown size={13} strokeWidth={3} />
            New message
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatMessageList;