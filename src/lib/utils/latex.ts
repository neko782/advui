import katex from 'katex';
import 'katex/dist/katex.min.css';

export function renderLatex(text: string, displayMode: boolean): string {
  return katex.renderToString(text.trim(), { displayMode, throwOnError: false });
}
