import { placeholder, placeholderMessage } from './tasks/placeholder.js';

// Blocks of a first session in their fixed order (decision 33;
// docs/11-technical-plan.md, section 2). build(block, ctx) returns the block's
// part of the jsPsych timeline; message(block, ctx) runs when the block ends
// and returns what to send to the receiver ({ summary, log, contact }) or
// null. ctx is { jsPsych, params, session, sender }. label is shown in the
// dev menu, task names the task that builds the block.

const block = (id, label, task, build = placeholder, message = placeholderMessage) => ({
  id,
  label,
  task,
  build,
  message,
});

export const BLOCKS = [
  block('device_check', 'Перевірка пристрою', 'Т0.5'),
  block('consent', 'Згода', 'Т2.2'),
  block('criteria', 'Критерії включення й виключення', 'Т2.2'),
  block('demographics', 'Біографічна анкета', 'Т2.2'),
  block('conditions', 'Анкета умов', 'Т2.2'),
  block('calibration', 'Калібрування екрана', 'Т0.6'),
  block('fullscreen', 'Повноекранний режим', 'Т0.5'),
  block('tmt_a', 'TMT, частина A', 'Т1.2–Т1.4'),
  block('tmt_b', 'TMT, частина B', 'Т1.2–Т1.4'),
  block('coding', 'Кодування символів', 'Т3.1'),
  block('stroop', 'Stroop', 'Т3.2'),
  block('sart', 'SART', 'Т3.3'),
  block('pss10', 'PSS-10', 'Т2.3'),
  block('post', 'Питання після тесту', 'Т2.3'),
  block('retest_invite', 'Запрошення на ретест', 'Т2.3'),
  block('thanks', 'Подяка', 'Т2.3'),
];

export const isPlaceholder = (b) => b.build === placeholder;
