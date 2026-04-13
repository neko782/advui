// Generation actions: send, refresh assistant, refresh after user
import { respond } from '../../openaiClient.js';
import { buildVisible as _buildVisible, buildVisibleUpTo as _buildVisibleUpTo } from '../../branching.js';
import { isAbortError } from '../../utils/errors.js';
import { updateVariantById } from './variantActions.js';
import { findNodeByMessageId } from '../../utils/treeUtils.js';
import type {
  ChatNode,
  MessageVariant,
  ChatSettings,
  GenerationContext,
  GenerationResponse,
  PreparedUserMessage,
  PreparedTypingNode,
  PreparedRefresh,
  HistoryMessage,
  ImageReference,
  ImageData,
  WebSearchOptions,
  CodeInterpreterOptions,
  ShellOptions,
  ImageGenerationOptions
} from '../../types/index.js';

/**
 * Validates that a typing variant is visible in the current graph
 */
export function validateTypingVariantVisible(
  nodes: ChatNode[],
  rootId: number | null,
  typingVariantId: number | null
): boolean {
  if (typingVariantId == null) return false;
  try {
    const visible = _buildVisible(nodes, rootId);
    return visible.some(vm => vm?.m?.id === typingVariantId && vm?.m?.typing === true);
  } catch {
    return false;
  }
}

/**
 * Extended validation result with details about the visibility state
 */
export interface TypingVisibilityResult {
  visible: boolean;
  exists: boolean;
  isTyping: boolean;
  isActive: boolean;
  nodeId: number | null;
  reason: string;
}

/**
 * Detailed validation of typing variant visibility.
 * Provides specific reasons for visibility failures.
 */
export function validateTypingVariantDetailed(
  nodes: ChatNode[],
  rootId: number | null,
  typingVariantId: number | null
): TypingVisibilityResult {
  if (typingVariantId == null) {
    return {
      visible: false,
      exists: false,
      isTyping: false,
      isActive: false,
      nodeId: null,
      reason: 'No typing variant ID provided',
    };
  }

  // Find the variant in nodes
  let foundNode: ChatNode | null = null;
  let foundVariantIndex = -1;
  let foundVariant: MessageVariant | null = null;

  for (const node of nodes) {
    const idx = (node?.variants || []).findIndex(v => v?.id === typingVariantId);
    if (idx >= 0) {
      foundNode = node;
      foundVariantIndex = idx;
      foundVariant = node.variants[idx];
      break;
    }
  }

  if (!foundNode || !foundVariant) {
    return {
      visible: false,
      exists: false,
      isTyping: false,
      isActive: false,
      nodeId: null,
      reason: 'Variant not found in nodes',
    };
  }

  const isTyping = foundVariant.typing === true;
  const activeIndex = Math.max(0, Math.min((foundNode.variants?.length || 1) - 1, Number(foundNode.active) || 0));
  const isActive = foundVariantIndex === activeIndex;

  // Check if it's in the visible path
  try {
    const visible = _buildVisible(nodes, rootId);
    const inPath = visible.some(vm => vm?.m?.id === typingVariantId);

    if (!inPath) {
      return {
        visible: false,
        exists: true,
        isTyping,
        isActive,
        nodeId: foundNode.id,
        reason: isActive
          ? 'Node not in visible path from root'
          : 'Variant exists but is not the active variant',
      };
    }

    if (!isTyping) {
      return {
        visible: false,
        exists: true,
        isTyping: false,
        isActive,
        nodeId: foundNode.id,
        reason: 'Variant is in path but typing flag is false',
      };
    }

    return {
      visible: true,
      exists: true,
      isTyping: true,
      isActive: true,
      nodeId: foundNode.id,
      reason: 'Variant is visible and typing',
    };
  } catch (err) {
    return {
      visible: false,
      exists: true,
      isTyping,
      isActive,
      nodeId: foundNode.id,
      reason: `Path traversal error: ${(err as Error)?.message || 'unknown'}`,
    };
  }
}

/**
 * Creates a guard function for safe streaming updates.
 * Returns a function that validates state before each update.
 */
export function createStreamingGuard(
  getNodes: () => ChatNode[],
  getRootId: () => number | null,
  typingVariantId: number,
  onInvalidate?: (reason: string) => void
): (update: () => void) => boolean {
  let invalidated = false;
  let lastReason = '';

  return (update: () => void): boolean => {
    if (invalidated) {
      return false;
    }

    const result = validateTypingVariantDetailed(getNodes(), getRootId(), typingVariantId);
    if (!result.visible) {
      invalidated = true;
      lastReason = result.reason;
      onInvalidate?.(result.reason);
      return false;
    }

    update();
    return true;
  };
}

/**
 * Creates a generation context with all necessary state
 * This ensures atomic updates and proper error handling
 */
export function createGenerationContext(options: {
  nodes: ChatNode[];
  rootId: number | null;
  nextId: number;
  nextNodeId: number;
}): GenerationContext {
  return {
    nodes: Array.isArray(options.nodes) ? options.nodes.slice() : [],
    rootId: options.rootId ?? null,
    nextId: typeof options.nextId === 'number' ? options.nextId : 1,
    nextNodeId: typeof options.nextNodeId === 'number' ? options.nextNodeId : 1,
    typingVariantId: null,
    error: null,
  };
}

/**
 * Applies a state update and validates it
 * Returns null if the update is invalid
 */
export function applyGenerationUpdate(
  context: GenerationContext,
  update: Partial<GenerationContext>
): GenerationContext | null {
  if (!update || typeof update !== 'object') return null;

  const nextContext: GenerationContext = {
    ...context,
    nodes: Array.isArray(update.nodes) ? update.nodes : context.nodes,
    rootId: update.rootId !== undefined ? update.rootId : context.rootId,
    nextId: typeof update.nextId === 'number' ? update.nextId : context.nextId,
    nextNodeId: typeof update.nextNodeId === 'number' ? update.nextNodeId : context.nextNodeId,
    typingVariantId: context.typingVariantId,
    error: context.error,
  };

  if (update.typingVariantId !== undefined) {
    nextContext.typingVariantId = update.typingVariantId;
  }

  // Validate that typing variant is visible if one was set
  if (nextContext.typingVariantId != null) {
    const isVisible = validateTypingVariantVisible(nextContext.nodes, nextContext.rootId, nextContext.typingVariantId);
    if (!isVisible) {
      nextContext.error = 'Typing variant is not visible in graph';
      return null;
    }
  }

  return nextContext;
}

/**
 * Logs generation lifecycle events when debug mode is enabled
 */
export function logGenerationEvent(debug: boolean, event: string, data: Record<string, unknown> = {}): void {
  if (!debug) return;
  const timestamp = new Date().toISOString();
  console.log(`[Generation ${timestamp}] ${event}`, data);
}

function normalizeImages(images: unknown): ImageReference[] {
  if (!Array.isArray(images)) return [];
  const map = new Map<string, ImageReference & { data?: string }>();
  for (const entry of images) {
    if (entry == null) continue;
    let id: string | null = null;
    let mimeType: string | undefined;
    let name: string | undefined;
    let data: string | undefined;
    if (typeof entry === 'string') {
      id = entry.trim();
      if (!id) continue;
    } else if (typeof entry === 'object') {
      const entryObj = entry as Record<string, unknown>;
      id = typeof entryObj.id === 'string' && (entryObj.id as string).trim() ? (entryObj.id as string).trim() : null;
      if (!id) continue;
      if (typeof entryObj.mimeType === 'string' && (entryObj.mimeType as string).trim()) mimeType = (entryObj.mimeType as string).trim();
      if (typeof entryObj.name === 'string' && (entryObj.name as string).trim()) name = (entryObj.name as string).trim();
      if (typeof entryObj.data === 'string' && entryObj.data) data = entryObj.data as string;
    } else {
      continue;
    }

    const existing = map.get(id);
    if (existing) {
      if (!existing.mimeType && mimeType) existing.mimeType = mimeType;
      if (!existing.name && name) existing.name = name;
      if (!(existing as { data?: string }).data && data) (existing as { data?: string }).data = data;
      continue;
    }

    const img: ImageReference & { data?: string } = { id };
    if (mimeType) img.mimeType = mimeType;
    if (name) img.name = name;
    if (data) img.data = data;
    map.set(id, img);
  }
  return [...map.values()];
}

export function prepareUserMessage(
  nodes: ChatNode[],
  rootId: number | null,
  input: string,
  nextId: number,
  nextNodeId: number,
  images: unknown[] = []
): PreparedUserMessage | null {
  const buildVisible = () => _buildVisible(nodes, rootId);
  const visible = buildVisible();
  const lastVm = visible.length ? visible[visible.length - 1] : null;
  const parentNodeId = lastVm ? lastVm.nodeId : null;

  const trimmedInput = (typeof input === 'string' ? input : '').trim();
  const normalizedImages = normalizeImages(images);
  const hasImages = normalizedImages.length > 0;
  if (!trimmedInput && !hasImages) return null;

  const newMsg: MessageVariant = {
    id: nextId,
    role: 'user',
    content: trimmedInput,
    time: Date.now(),
    typing: false,
    error: undefined,
    next: null,
    images: hasImages ? normalizedImages : undefined
  };
  const newNode: ChatNode = { id: nextNodeId, variants: [newMsg], active: 0 };
  const newNodeId = newNode.id;

  let arr = nodes.slice();
  arr.push(newNode);

  let nextRootId = rootId;
  if (parentNodeId != null) {
    arr = arr.map(n => (n.id === parentNodeId
      ? (() => {
          const activeIndex = Math.max(0, Math.min((n.variants?.length || 1) - 1, Number(n.active) || 0));
          return { ...n, variants: n.variants.map((v, i) => (i === activeIndex ? { ...v, next: newNode.id } : v)) };
        })()
      : n));
  } else {
    nextRootId = newNode.id;
  }

  return {
    nodes: arr,
    rootId: nextRootId,
    nextId: nextId + 1,
    nextNodeId: nextNodeId + 1,
    newNodeId
  };
}

export function prepareTypingNode(
  nodes: ChatNode[],
  rootId: number | null,
  parentNodeId: number | null,
  nextId: number,
  nextNodeId: number
): PreparedTypingNode {
  const typingVariant: MessageVariant = {
    id: nextId,
    role: 'assistant',
    content: 'typing',
    time: Date.now(),
    typing: true,
    error: undefined,
    next: null,
    reasoningSummary: '',
    reasoningSummaryLoading: true,
  };
  const typingVariantId = typingVariant.id;
  const typingNode: ChatNode = { id: nextNodeId, variants: [typingVariant], active: 0 };

  let arr = nodes.slice();
  let nextRootId = rootId;

  if (parentNodeId != null) {
    arr = arr.map(n => {
      if (n.id !== parentNodeId) return n;
      const activeIndex = Math.max(0, Math.min((n.variants?.length || 1) - 1, Number(n.active) || 0));
      return {
        ...n,
        variants: n.variants.map((v, i) => (i === activeIndex ? { ...v, next: typingNode.id } : v)),
      };
    });
  } else {
    nextRootId = typingNode.id;
  }

  arr = [...arr, typingNode];

  return {
    nodes: arr,
    rootId: nextRootId,
    typingVariantId,
    nextId: nextId + 1,
    nextNodeId: nextNodeId + 1
  };
}

export interface GenerateResponseOptions {
  nodes: ChatNode[];
  rootId: number | null;
  chatSettings: ChatSettings;
  connectionId: string | null;
  streaming: boolean;
  typingVariantId: number | null;
  onAbort?: (abortFn: () => void) => void;
  onTextDelta?: (fullText: string) => void;
  onReasoningSummaryDelta?: (fullSummary: string) => void;
  onReasoningSummaryDone?: (fullSummary: string) => void;
}

export async function generateResponse(options: GenerateResponseOptions): Promise<GenerationResponse> {
  const {
    nodes,
    rootId,
    chatSettings,
    connectionId,
    streaming,
    typingVariantId,
    onAbort,
    onTextDelta,
    onReasoningSummaryDelta,
    onReasoningSummaryDone
  } = options;

  const buildVisible = () => _buildVisible(nodes, rootId);
  const history: HistoryMessage[] = buildVisible()
    .map(vm => vm.m)
    .filter(m => !m.typing)
    .map(({ role, content, images }) => {
      const msg: HistoryMessage = { role, content };
      const normalized = normalizeImages(images);
      if (normalized.length > 0) {
        msg.images = normalized as ImageData[];
      }
      return msg;
    });

  // Build web search options if enabled
  const webSearch: WebSearchOptions | undefined = chatSettings.webSearchEnabled
    ? {
        enabled: true,
        filters: chatSettings.webSearchDomains
          ? { allowed_domains: chatSettings.webSearchDomains.split(',').map(d => d.trim()).filter(Boolean) }
          : undefined,
        user_location: (chatSettings.webSearchCountry || chatSettings.webSearchCity || chatSettings.webSearchRegion || chatSettings.webSearchTimezone)
          ? {
              type: 'approximate' as const,
              country: chatSettings.webSearchCountry || undefined,
              city: chatSettings.webSearchCity || undefined,
              region: chatSettings.webSearchRegion || undefined,
              timezone: chatSettings.webSearchTimezone || undefined,
            }
          : undefined,
        external_web_access: chatSettings.webSearchCacheOnly ? false : undefined,
      }
    : undefined;

  // Build code interpreter options if enabled
  const codeInterpreter: CodeInterpreterOptions | undefined = chatSettings.codeInterpreterEnabled
    ? {
        enabled: true,
      }
    : undefined;

  // Build shell options if enabled
  const shell: ShellOptions | undefined = chatSettings.shellEnabled
    ? {
        enabled: true,
      }
    : undefined;

  // Build image generation options if enabled
  const imageGeneration: ImageGenerationOptions | undefined = chatSettings.imageGenerationEnabled
    ? {
        enabled: true,
        model: chatSettings.imageGenerationModel || undefined,
      }
    : undefined;

  const responseOptions = {
    messages: history,
    model: chatSettings.model,
    maxOutputTokens: chatSettings.maxOutputTokens,
    topP: chatSettings.topP,
    temperature: chatSettings.temperature,
    reasoningEffort: chatSettings.reasoningEffort,
    textVerbosity: chatSettings.textVerbosity,
    reasoningSummary: chatSettings.reasoningSummary,
    thinkingEnabled: chatSettings.thinkingEnabled,
    thinkingBudgetTokens: chatSettings.thinkingBudgetTokens,
    connectionId,
    webSearch,
    codeInterpreter,
    shell,
    imageGeneration,
  };

  if (streaming && typingVariantId != null) {
    return await respond({
      ...responseOptions,
      stream: true,
      onAbort,
      onTextDelta,
      onReasoningSummaryDelta,
      onReasoningSummaryDone,
    });
  } else {
    return await respond({
      ...responseOptions,
      onAbort,
      onReasoningSummaryDone,
    });
  }
}

export function handleGenerationSuccess(
  nodes: ChatNode[],
  typingVariantId: number | null,
  reply: GenerationResponse | string | null,
  summaryBuffer: string
): ChatNode[] {
  if (typingVariantId == null) return nodes;

  const replyText = (reply && typeof reply === 'object') ? (reply.text ?? '') : (typeof reply === 'string' ? reply : '');
  const replySummary = (() => {
    if (reply && typeof reply === 'object') {
      if (typeof reply.reasoningSummary === 'string' && reply.reasoningSummary) return reply.reasoningSummary;
      return summaryBuffer;
    }
    return summaryBuffer;
  })();
  const replyImages = (reply && typeof reply === 'object' && Array.isArray(reply.generatedImages))
    ? reply.generatedImages
    : undefined;

  return updateVariantById(nodes, typingVariantId, (prev) => ({
    ...prev,
    content: replyText,
    typing: false,
    error: undefined,
    reasoningSummary: replySummary || '',
    reasoningSummaryLoading: false,
    generatedImages: replyImages,
  }));
}

export function handleGenerationError(
  nodes: ChatNode[],
  typingVariantId: number | null,
  err: unknown
): ChatNode[] {
  if (typingVariantId == null) return nodes;

  const aborted = isAbortError(err);
  if (aborted) {
    return updateVariantById(nodes, typingVariantId, (prev) => ({
      ...prev,
      typing: false,
      error: undefined,
      reasoningSummaryLoading: false,
      content: (prev.content === 'typing' ? '' : prev.content),
    }));
  } else {
    const msg = (err as Error)?.message || 'Something went wrong.';
    return updateVariantById(nodes, typingVariantId, (prev) => ({
      ...prev,
      typing: false,
      error: msg,
      reasoningSummaryLoading: false,
      content: (prev.content === 'typing' ? '' : prev.content),
    }));
  }
}

export function prepareRefreshAssistant(
  nodes: ChatNode[],
  rootId: number | null,
  messageId: number,
  nextId: number
): PreparedRefresh | null {
  const buildVisible = () => _buildVisible(nodes, rootId);
  const buildVisibleUpTo = (indexExclusive: number) => _buildVisibleUpTo(nodes, rootId, indexExclusive);

  const loc = findNodeByMessageId(nodes, messageId);
  const node = loc?.node;
  const target = node?.variants?.[loc.index];
  if (!node || !target || target.role !== 'assistant' || target.typing) return null;

  const typingMsg: MessageVariant = {
    id: nextId,
    role: 'assistant',
    content: 'typing',
    time: Date.now(),
    typing: true,
    error: undefined,
    next: null,
    reasoningSummary: '',
    reasoningSummaryLoading: true,
  };

  const updatedNodes = nodes.map(n => (
    n.id === node.id
      ? { ...n, variants: [...(n.variants || []), typingMsg], active: (n.variants?.length || 0) }
      : n
  ));

  // Build history up to (but not including) this assistant node
  const path = buildVisible();
  const parentPathIndex = path.findIndex(vm => vm.nodeId === node.id) - 1;
  const history: HistoryMessage[] = buildVisibleUpTo((parentPathIndex >= 0 ? parentPathIndex + 1 : 0))
    .filter(m => !m.typing)
    .map(({ role, content, images }) => {
      const msg: HistoryMessage = { role, content };
      const normalized = normalizeImages(images);
      if (normalized.length > 0) {
        msg.images = normalized as ImageData[];
      }
      return msg;
    });

  return {
    nodes: updatedNodes,
    nextId: nextId + 1,
    typingVariantId: typingMsg.id,
    history
  };
}

export function prepareRefreshAfterUser(
  nodes: ChatNode[],
  rootId: number | null,
  messageIndex: number,
  nextId: number,
  nextNodeId: number
): PreparedRefresh | null {
  const buildVisible = () => _buildVisible(nodes, rootId);
  const buildVisibleUpTo = (indexExclusive: number) => _buildVisibleUpTo(nodes, rootId, indexExclusive);

  const path = buildVisible();
  const vm = (typeof messageIndex === 'number') ? path[messageIndex] : null;
  const curMsg = vm?.m;
  const curNodeId = vm?.nodeId;
  if (!curMsg || !curNodeId) return null;

  const typingMsg: MessageVariant = {
    id: nextId,
    role: 'assistant',
    content: 'typing',
    time: Date.now(),
    typing: true,
    error: undefined,
    next: null,
    reasoningSummary: '',
    reasoningSummaryLoading: true,
  };

  const typingNode: ChatNode = { id: nextNodeId, variants: [typingMsg], active: 0 };
  let updatedNodes = nodes.map(n => (
    n.id === curNodeId
      ? (() => {
          const activeIndex = Math.max(0, Math.min((n.variants?.length || 1) - 1, Number(n.active) || 0));
          return { ...n, variants: n.variants.map((v, idx) => (idx === activeIndex ? { ...v, next: typingNode.id } : v)) };
        })()
      : n
  ));
  updatedNodes = [...updatedNodes, typingNode];

  const history: HistoryMessage[] = buildVisibleUpTo(messageIndex + 1)
    .filter(m => !m.typing)
    .map(({ role, content, images }) => {
      const msg: HistoryMessage = { role, content };
      const normalized = normalizeImages(images);
      if (normalized.length > 0) {
        msg.images = normalized as ImageData[];
      }
      return msg;
    });

  return {
    nodes: updatedNodes,
    nextId: nextId + 1,
    nextNodeId: nextNodeId + 1,
    typingVariantId: typingMsg.id,
    history
  };
}
