import { APP_VERSION } from './config.js';
import { texts } from './texts.uk.js';
import { parseUrl, buildParams, selectBlocks } from './session.js';
import { BLOCKS } from './blocks.js';
import { initJsPsych, libsLoaded } from './lib.js';
import { renderDevMenu, renderDevBadge, renderDevEnd } from './dev.js';

// Entry point: reads the URL, then either shows the dev menu or runs the
// session blocks in their fixed order.

function showMessage(text) {
  const message = document.createElement('p');
  message.className = 'message';
  message.textContent = text;
  document.body.replaceChildren(message);
}

function start() {
  document.title = texts.common.pageTitle;

  const session = parseUrl(window.location.search);
  if (session.error) return showMessage(texts.errors.badLink);
  if (!libsLoaded) return showMessage(texts.errors.loadFailed);

  const isDev = session.mode === 'dev';
  if (isDev && session.devStart === null && session.devOnly === null) {
    return renderDevMenu(BLOCKS, session);
  }

  // Both can throw only in dev mode: overrides and block choice come from dev links.
  let params, blocks;
  try {
    params = buildParams(session.overrides);
    blocks = selectBlocks(BLOCKS, session);
  } catch (error) {
    return showMessage(error.message);
  }

  const jsPsych = initJsPsych({
    display_element: 'jspsych-target',
    on_finish: () =>
      isDev ? renderDevEnd(jsPsych, session) : showMessage(texts.common.sessionEnd),
  });
  jsPsych.data.addProperties({ app_version: APP_VERSION, mode: session.mode });

  if (isDev) {
    renderDevBadge(session);
    // Handle for debugging in the browser console and for automated checks.
    window.tmtua = { jsPsych, params, session };
  }

  const ctx = { jsPsych, params, session };
  jsPsych.run(blocks.flatMap((b) => b.build(b, ctx)));
}

start();
