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
