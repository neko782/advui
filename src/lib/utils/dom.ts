// DOM helpers used by multiple components

export interface AutoGrowOptions {
  maxHeight?: number;
  minHeight?: number;
}

export function placeCaretAtEnd(el: HTMLElement): void {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch {
    // Ignore caret placement errors
  }
}

export function autoGrow(el: HTMLElement | null, options: AutoGrowOptions = {}): void {
  if (!el) return;
  const max = options.maxHeight ?? 240;
  const min = options.minHeight ?? 44;
  try {
    el.style.height = 'auto';
    const content = el.scrollHeight;
    const next = Math.min(content, max);
    el.style.height = Math.max(next, min) + 'px';
    el.style.overflowY = content > max ? 'auto' : 'hidden';
  } catch {
    // Ignore auto-grow errors
  }
}

