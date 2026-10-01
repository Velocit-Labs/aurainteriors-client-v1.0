import api from './index';
import { getGuestSessionId } from '../utils/guestSessionStorage';
import { compressFileIfNeeded } from '../utils/imageCompression';

// Helper to add guestSessionId to request data
const addGuestSessionId = (data = {}) => {
  const guestSessionId = getGuestSessionId();
  if (guestSessionId) {
    return { ...data, guestSessionId };
  }
  return data;
};

/**
 * Get upload signature for direct Cloudinary uploads
 */
export const getUploadSignature = async () => {
  const response = await api.get('/chats/signature/upload');
  return response.data;
};

/**
 * Upload file directly to Cloudinary with automatic retry on failure
 * - Compresses images before upload
 * - Retries failed uploads with exponential backoff (max 3 attempts)
 * - Returns immediately with public URL on success
 */
export const uploadToCloudinary = async (file, uploadConfig, options = {}) => {
  const { maxRetries = 1, timeoutMs = 8000 } = options;

  // Compress image if applicable (reduces bandwidth significantly)
  const fileToUpload = await compressFileIfNeeded(file);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${uploadConfig.cloudName}/auto/upload`;

  // Retry logic with exponential backoff
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Create fresh FormData for each attempt (required for multipart/form-data)
      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('upload_preset', uploadConfig.uploadPreset);
      formData.append('folder', uploadConfig.folder);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(uploadUrl, {
        method: 'POST',
        signal: controller.signal,
        body: formData,
        // Note: keepalive not supported with multipart/form-data in all browsers
        // Browser handles connection reuse automatically via HTTP/2
      });

      clearTimeout(timeoutId);
      if (!response.ok) {
        let errorMessage = response.statusText;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error?.message || response.statusText;
        } catch (e) {
          // Response wasn't JSON, use status text
        }
        throw new Error(`Upload failed (${response.status}): ${errorMessage}`);
      }

      const result = await response.json();
      console.log(`✓ Upload success for ${file.name}:`, {
        url: result.secure_url,
        publicId: result.public_id,
        size: result.bytes,
      });
      return result;
    } catch (error) {
      lastError = error;
      console.warn(
        `Upload attempt ${attempt + 1}/${maxRetries} failed for ${file.name}:`,
        error.message
      );


    }
  }

  // All retries exhausted
  throw lastError;
};

export const startChat = async (data) => {
    const payload = addGuestSessionId(data);
    const response = await api.post('/chats', payload);
    return response.data;
};

export const getMyChats = async ({ page = 1, limit = 20, status } = {}) => {
    const params = new URLSearchParams();
    const guestSessionId = getGuestSessionId();
    if (guestSessionId) params.append('guestSessionId', guestSessionId);
    params.append('page', page);
    params.append('limit', limit);
    if (status) params.append('status', status);

    const response = await api.get(`/chats/my?${params}`);
    return response.data;
};

export const getChatDetails = async (chatId) => {
    const guestSessionId = getGuestSessionId();
    const response = await api.get(`/chats/${chatId}`, {
      params: guestSessionId ? { guestSessionId } : undefined,
    });
    return response.data;
};

export const getChatMessages = async ({ chatId, page = 1, limit = 50 }) => {
    const params = new URLSearchParams();
    params.append('page', page);
    params.append('limit', limit);
    
    // Add guest session ID if guest
    const guestSessionId = getGuestSessionId();
    if (guestSessionId) {
      params.append('guestSessionId', guestSessionId);
    }

    const response = await api.get(`/chats/${chatId}/messages?${params}`);
    return response.data;
};

export const sendMessage = async ({ chatId, content, attachments, clientMessageId }) => {
    // Attachments are now just metadata with Cloudinary URLs (already uploaded)
    const payload = { content, attachments: attachments || [], clientMessageId, ...addGuestSessionId() };
    const response = await api.post(`/chats/${chatId}/messages`, payload);
    return response.data;
};

export const markMessagesAsRead = async (chatId) => {
    const payload = addGuestSessionId();
    const response = await api.patch(`/chats/${chatId}/read`, payload);
    return response.data;
};

export const closeChat = async (chatId) => {
    const response = await api.patch(`/chats/${chatId}/close`, addGuestSessionId());
    return response.data;
};

export const getAllChats = async ({ page = 1, limit = 20, status, priority, sortBy = 'lastMessageAt' } = {}) => {
    const params = new URLSearchParams();
    params.append('page', page);
    params.append('limit', limit);
    if (status) params.append('status', status);
    if (priority) params.append('priority', priority);
    params.append('sortBy', sortBy);

    const response = await api.get(`/chats/admin/all?${params}`);
    return response.data;
};

export const getWaitingQueue = async () => {
    const response = await api.get('/chats/admin/queue');
    return response.data;
};

export const resolveChat = async (chatId) => {
    const response = await api.patch(`/chats/${chatId}/resolve`);
    return response.data;
};

export const getChatStats = async () => {
    const response = await api.get('/chats/admin/stats');
    return response.data;
};

export const toggleBot = async ({ chatId, botActive }) => {
    const response = await api.patch(`/chats/${chatId}/toggle-bot`, { botActive });
    return response.data;
};

/**
 * Update message attachments with real Cloudinary URLs after upload completes
 * Syncs temporary blob URLs to permanent Cloudinary URLs in the database
 */
export const updateMessageAttachments = async (chatId, messageId, attachments) => {
    const payload = { 
        attachments: attachments || [], 
        ...addGuestSessionId() 
    };
    const response = await api.patch(`/chats/${chatId}/messages/${messageId}/attachments`, payload);
    return response.data;
};

export default {
    getUploadSignature,
    uploadToCloudinary,
    startChat,
    getMyChats,
    getChatDetails,
    getChatMessages,
    sendMessage,
    markMessagesAsRead,
    closeChat,
    getAllChats,
    getWaitingQueue,
    resolveChat,
    getChatStats,
    toggleBot,
    updateMessageAttachments,
};
