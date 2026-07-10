// ============================================================================
// ATTACHMENT MIME TYPE DETECTION & DISPLAY
// Single source of truth for attachment type handling.
// Used by: Chat.svelte, Composer.svelte, MessageBubble.svelte, openaiClient.ts
// ============================================================================

export interface AttachmentLike {
  id?: string;
  name?: string;
  mimeType?: string;
  data?: string;
}

export function normalizeMimeType(mimeType: unknown): string {
  if (typeof mimeType !== 'string') return '';
  return mimeType.trim().toLowerCase();
}

// --- MIME-string predicates -------------------------------------------------

export function isImageMimeType(mimeType: string | undefined): boolean {
  return normalizeMimeType(mimeType).startsWith('image/');
}

export function isVideoMimeType(mimeType: string | undefined): boolean {
  return normalizeMimeType(mimeType).startsWith('video/');
}

export function isAudioMimeType(mimeType: string | undefined): boolean {
  return normalizeMimeType(mimeType).startsWith('audio/');
}

export function isPdfMimeType(mimeType: string | undefined): boolean {
  return normalizeMimeType(mimeType) === 'application/pdf';
}

// --- Attachment-object predicates (mime with filename fallback) --------------

export function isImageAttachment(attachment: unknown): boolean {
  if (!attachment || typeof attachment !== 'object') return false;
  const a = attachment as AttachmentLike;
  const mime = typeof a.mimeType === 'string' ? a.mimeType : '';
  if (mime.startsWith('image/')) return true;
  if (!mime && typeof a.name === 'string') {
    return /\.(png|jpe?g|gif|webp)$/i.test(a.name);
  }
  return false;
}

export function isVideoAttachment(attachment: unknown): boolean {
  if (!attachment || typeof attachment !== 'object') return false;
  const a = attachment as AttachmentLike;
  const mime = normalizeMimeType(a.mimeType);
  if (mime.startsWith('video/')) return true;
  if (!mime && typeof a.name === 'string') {
    return /\.(mp4|webm|mov|avi|mkv)$/i.test(a.name);
  }
  return false;
}

export function isAudioAttachment(attachment: unknown): boolean {
  if (!attachment || typeof attachment !== 'object') return false;
  const a = attachment as AttachmentLike;
  const mime = normalizeMimeType(a.mimeType);
  if (mime.startsWith('audio/')) return true;
  if (!mime && typeof a.name === 'string') {
    return /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(a.name);
  }
  return false;
}

export function isPdfAttachment(attachment: unknown): boolean {
  if (!attachment || typeof attachment !== 'object') return false;
  const a = attachment as AttachmentLike;
  const mime = normalizeMimeType(a.mimeType);
  if (mime === 'application/pdf') return true;
  if (!mime && typeof a.name === 'string') {
    return a.name.toLowerCase().endsWith('.pdf');
  }
  return false;
}

// --- Upload support & MIME inference -----------------------------------------

/** All file types are accepted; unknown types are sent as generic files. */
export function isSupportedAttachment(file: unknown): boolean {
  return !!file;
}

const EXTENSION_MIME_MAP: Array<[RegExp, string]> = [
  // Image types
  [/\.png$/, 'image/png'],
  [/\.jpe?g$/, 'image/jpeg'],
  [/\.gif$/, 'image/gif'],
  [/\.webp$/, 'image/webp'],
  [/\.svg$/, 'image/svg+xml'],
  [/\.bmp$/, 'image/bmp'],
  [/\.ico$/, 'image/x-icon'],
  // PDF
  [/\.pdf$/, 'application/pdf'],
  // Video types
  [/\.mp4$/, 'video/mp4'],
  [/\.webm$/, 'video/webm'],
  [/\.mov$/, 'video/quicktime'],
  [/\.avi$/, 'video/x-msvideo'],
  // Audio types
  [/\.mp3$/, 'audio/mpeg'],
  [/\.wav$/, 'audio/wav'],
  [/\.ogg$/, 'audio/ogg'],
  [/\.m4a$/, 'audio/mp4'],
  // Text and code types
  [/\.(txt|text|log)$/, 'text/plain'],
  [/\.(md|markdown)$/, 'text/markdown'],
  [/\.html?$/, 'text/html'],
  [/\.css$/, 'text/css'],
  [/\.(js|mjs)$/, 'application/javascript'],
  [/\.tsx?$/, 'application/typescript'],
  [/\.json$/, 'application/json'],
  [/\.xml$/, 'text/xml'],
  [/\.csv$/, 'text/csv'],
  [/\.tsv$/, 'text/tsv'],
  [/\.ya?ml$/, 'application/yaml'],
  [/\.toml$/, 'application/toml'],
  [/\.py$/, 'text/x-python'],
  [/\.rb$/, 'text/x-ruby'],
  [/\.rs$/, 'text/x-rust'],
  [/\.go$/, 'text/x-go'],
  [/\.java$/, 'text/x-java'],
  [/\.(c|h)$/, 'text/x-c'],
  [/\.(cpp|cc|cxx|hh)$/, 'text/x-c++'],
  [/\.cs$/, 'text/x-csharp'],
  [/\.swift$/, 'text/x-swift'],
  [/\.kt$/, 'text/x-kotlin'],
  [/\.php$/, 'text/x-php'],
  [/\.(sh|bash|zsh)$/, 'text/x-sh'],
  [/\.sql$/, 'application/x-sql'],
  [/\.r$/, 'text/x-r'],
  [/\.pl$/, 'text/x-perl'],
  [/\.lua$/, 'text/x-lua'],
  [/\.jsx$/, 'text/jsx'],
  [/\.(vue|svelte)$/, 'text/plain'],
  [/\.rst$/, 'text/x-rst'],
  [/\.tex$/, 'text/x-tex'],
  [/\.srt$/, 'text/srt'],
  [/\.vtt$/, 'text/vtt'],
  // Rich document types
  [/\.docx$/, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  [/\.doc$/, 'application/msword'],
  [/\.pptx$/, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  [/\.ppt$/, 'application/vnd.ms-powerpoint'],
  [/\.xlsx$/, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  [/\.xls$/, 'application/vnd.ms-excel'],
  [/\.rtf$/, 'application/rtf'],
  [/\.odt$/, 'application/vnd.oasis.opendocument.text'],
];

export function inferMimeTypeFromName(name: unknown): string {
  if (typeof name !== 'string' || !name) return '';
  const lower = name.toLowerCase();
  for (const [pattern, mime] of EXTENSION_MIME_MAP) {
    if (pattern.test(lower)) return mime;
  }
  return '';
}

export function inferMimeType(file: { type?: string; name?: string } | null | undefined): string {
  if (!file) return '';
  if (typeof file.type === 'string' && file.type) return file.type;
  return inferMimeTypeFromName(file.name);
}

// --- Filenames, labels, data URLs --------------------------------------------

export function inferAttachmentFilename(
  attachment: AttachmentLike | null,
  fallbackBase: string = 'attachment'
): string {
  if (!attachment || typeof attachment !== 'object') return `${fallbackBase}`;
  if (typeof attachment.name === 'string' && attachment.name.trim()) return attachment.name.trim();
  if (typeof attachment.id === 'string' && attachment.id.trim()) {
    const id = attachment.id.trim();
    if (isPdfMimeType(attachment.mimeType) && !id.toLowerCase().endsWith('.pdf')) {
      return `${id}.pdf`;
    }
    return id;
  }
  if (isPdfMimeType(attachment?.mimeType)) return `${fallbackBase}.pdf`;
  return fallbackBase;
}

export function attachmentDisplayName(attachment: unknown): string {
  if (!attachment || typeof attachment !== 'object') return 'attachment';
  const a = attachment as AttachmentLike;
  if (typeof a.name === 'string' && a.name.trim()) return a.name.trim();
  if (typeof a.id === 'string' && a.id.trim()) return a.id.trim();
  return 'attachment';
}

/** Label used in the composer chips (checks video/audio first, falls back to FILE). */
export function attachmentTypeLabel(attachment: unknown): string {
  if (isVideoAttachment(attachment)) return 'VIDEO';
  if (isAudioAttachment(attachment)) return 'AUDIO';
  const mime = typeof (attachment as AttachmentLike)?.mimeType === 'string'
    ? (attachment as AttachmentLike).mimeType!
    : '';
  if (mime === 'application/pdf') return 'PDF';
  if (mime) {
    const parts = mime.split('/');
    if (parts.length === 2 && parts[1]) return parts[1].toUpperCase();
  }
  return 'FILE';
}

/** Label used in message bubbles (PDF check first, uppercases full mime as fallback). */
export function attachmentMimeLabel(attachment: unknown): string {
  if (isPdfAttachment(attachment)) return 'PDF';
  const mime = typeof (attachment as AttachmentLike)?.mimeType === 'string'
    ? (attachment as AttachmentLike).mimeType!
    : '';
  if (!mime) return 'FILE';
  const parts = mime.split('/');
  if (parts.length === 2 && parts[1]) return parts[1].toUpperCase();
  return mime.toUpperCase();
}

export function ensureDataUrl(data: unknown, mimeType: string | undefined): string {
  if (typeof data !== 'string' || !data) return '';
  if (data.startsWith('data:')) return data;
  const mime = normalizeMimeType(mimeType) || 'application/octet-stream';
  return `data:${mime};base64,${data}`;
}

export function attachmentDataUrl(attachment: unknown): string {
  if (!attachment || typeof attachment !== 'object') return '';
  const a = attachment as AttachmentLike;
  const data = typeof a.data === 'string' && a.data ? a.data : '';
  if (!data) return '';
  const mime = typeof a.mimeType === 'string' && a.mimeType
    ? a.mimeType
    : (isPdfAttachment(a)
      ? 'application/pdf'
      : (isImageAttachment(a) ? 'image/png' : 'application/octet-stream'));
  return `data:${mime};base64,${data}`;
}
