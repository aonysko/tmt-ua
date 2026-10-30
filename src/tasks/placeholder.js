import { HtmlButtonResponse } from '../lib.js';
import { texts } from '../texts.uk.js';

// Stand-in screen for a block whose task is not built yet. Visible only
// during development, so its wording stays here rather than in texts.uk.js.
export function placeholder(block) {
  return [
    {
      type: HtmlButtonResponse,
      stimulus: `<p class="placeholder">Заглушка: ${block.label} (таск ${block.task})</p>`,
      choices: [texts.common.next],
      data: { block: block.id },
    },
  ];
}

// Outside main mode a placeholder sends a one-column marker, so that data
// delivery can be checked end to end; in main mode it sends nothing, which
// keeps the main spreadsheet empty until real data collection.
export function placeholderMessage(block, ctx) {
  if (ctx.session.mode === 'main') return null;
  return { summary: { [`${block.id}_placeholder`]: 1 } };
}
