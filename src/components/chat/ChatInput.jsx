import { useState, useRef, useEffect } from "react";
import { LucideSendHorizontal, Paperclip, Smile, X, AlertCircle } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useSendMessage } from "../../hooks/chat/useChatTan";
import { getUploadSignature, uploadToCloudinary } from "../../api/chatApi";
import AuthRequiredModal from "./AuthRequiredModal";
import RateLimitModal from "./RateLimitModal";
import { toast } from "react-toastify";

const ChatInput = ({ chatId, onTyping }) => {
  const [message, setMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showRateLimitModal, setShowRateLimitModal] = useState(false);
  const [rateLimitRetry, setRateLimitRetry] = useState(900);
  const [authError, setAuthError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({}); // Track upload state per file
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const textareaRef = useRef(null);
  const sendMessageMutation = useSendMessage();
  const uploadCacheRef = useRef({}); // Cache Cloudinary credentials to avoid repeated fetches
  const blobUrlsRef = useRef({}); // Track blob URLs for cleanup
  
  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(blobUrlsRef.current).forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

  const handleTypingChange = (value) => {
    setMessage(value);
    onTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => onTyping(false), 1000);
  };

  const handleFileSelect = async (files) => {
    const newFiles = Array.from(files);
    setSelectedFiles((prev) => [...prev, ...newFiles]);
  };

  const handleSend = async () => {
    const text = message.trim();
    const files = [...selectedFiles];
    if (!text && files.length === 0) return;

    // Clear the composer immediately. The message cache is optimistic for text, so
    // the input never feels blocked by a production round trip.
    setMessage("");
    setSelectedFiles([]);
    onTyping(false);
    if (textareaRef.current) textareaRef.current.style.height = "24px";

    try {
      let attachments = [];
      if (files.length > 0) {
        setIsUploading(true);
        if (!uploadCacheRef.current.signature) {
          const signatureResponse = await getUploadSignature();
          uploadCacheRef.current.signature = signatureResponse.data.signature;
          setTimeout(() => { uploadCacheRef.current.signature = null; }, 50 * 60 * 1000);
        }
        const uploadConfig = uploadCacheRef.current.signature;
        const results = await Promise.all(files.map(async (file) => {
          const result = await uploadToCloudinary(file, uploadConfig, { maxRetries: 3, retryDelay: 1000 });
          return {
            fileName: file.name,
            fileUrl: result.secure_url,
            fileType: file.type.startsWith("image") ? "image" : "document",
            fileSize: file.size,
          };
        }));
        attachments = results;
      }

      sendMessageMutation.mutate(
        { chatId, content: text, attachments },
        {
          onError: (error) => {
            // Restore text so a failed request never makes the user's input disappear.
            if (text) setMessage(text);
            const response = error.response?.data;
            if (response?.code === "AUTH_REQUIRED") {
              setAuthError({ message: response.message, suggestion: response.suggestion });
              setShowAuthModal(true);
            }
            if (response?.code === "RATE_LIMIT_EXCEEDED") {
              setRateLimitRetry(response.retryAfter || 900);
              setShowRateLimitModal(true);
            }
          },
        }
      );
    } catch (error) {
      console.error("Error sending chat message:", error);
      if (text) setMessage(text);
      if (files.length) setSelectedFiles(files);
      toast.error(files.length ? "Attachment upload failed. Please try again." : "Failed to send message");
    } finally {
      setIsUploading(false);
    }
  };


  const canSend =
    (message.trim() || selectedFiles.length > 0) &&
    !sendMessageMutation.isPending &&
    !isUploading;

  return (
    <>
      <div className="bg-white px-4 py-3 border-t border-gray-100/35">
        <AnimatePresence>
          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-3">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="relative bg-white border border-gray-200 rounded-lg px-3 py-2 pr-8 text-xs font-medium"
                >
                  {file.name}
                  <button
                    onClick={() =>
                      setSelectedFiles((prev) =>
                        prev.filter((_, i) => i !== index)
                      )
                    }
                    className="absolute right-1 top-1.5 p-0.5 text-gray-400 hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3 w-full">
          {/* Left Actions */}
          <div className="flex items-center gap-1 text-gray-400 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files)}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="p-2 rounded-lg hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-50"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />
          </div>

          {/* Text Input */}
          <div className="flex flex-1 items-center min-h-[46px] rounded-full bg-gray-100 pl-4 pr-2">
            <textarea
              ref={textareaRef}
              value={message}
              rows={1}
              onChange={(e) => {
                handleTypingChange(e.target.value);
                e.target.style.height = "24px";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              placeholder="Type your message..."
              disabled={isUploading}
              className="flex-1 bg-transparent text-[14px] leading-5 text-gray-800 placeholder:text-gray-400 resize-none focus:outline-none overflow-y-auto max-h-[120px] py-3 disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isUploading) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />

            <button
              type="button"
              className="shrink-0 rounded-full p-1.5 text-[#F27318] transition-colors hover:text-gray-600 hover:bg-white/70"
            >
              <Smile className="h-5 w-5" />
            </button>
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`p-2 transition-colors ${
              canSend
                ? "text-[#F27318] hover:text-[#D9620E]"
                : "text-gray-300 cursor-not-allowed"
            }`}
          >
            {sendMessageMutation.isPending || isUploading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#F27318]" />
            ) : (
              <LucideSendHorizontal className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>

      {/* Error Modals */}
      <AuthRequiredModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message={authError?.message}
        suggestion={authError?.suggestion}
      />

      <RateLimitModal
        isOpen={showRateLimitModal}
        onClose={() => setShowRateLimitModal(false)}
        retryAfter={rateLimitRetry}
      />
    </>
  );
};

export default ChatInput;