import { source } from '../game/source.js';

export async function runProjectApply(options) {
  const preview = options.dryRun;
  const token = crypto.randomUUID().replaceAll('-', '');
  const dialog = document.createElement('dialog');
  dialog.className = 'project-apply-progress';
  dialog.setAttribute('aria-labelledby', 'apply-progress-title');
  dialog.innerHTML = `
    <h2 id="apply-progress-title">${preview ? 'Preparing Apply preview' : 'Applying project'}</h2>
    <p class="apply-project-name"></p>
    <div class="apply-progress-row">
      <progress value="0" max="100" aria-label="Project progress"></progress>
      <span class="apply-percent">0%</span>
    </div>
    <p class="apply-phase" role="status">Waiting to start</p>
    ${preview ? '' : '<p class="muted apply-wait">Wait for 100% before launching the game.</p>'}
    <form method="dialog"><button disabled>Done</button></form>`;
  document.body.append(dialog);
  dialog.querySelector('.apply-project-name').textContent = options.name;
  const meter = dialog.querySelector('progress');
  const percentage = dialog.querySelector('.apply-percent');
  const phase = dialog.querySelector('.apply-phase');
  const wait = dialog.querySelector('.apply-wait');
  const done = dialog.querySelector('button');
  const update = ({percent, message}) => {
    if (percent < meter.value) return;
    meter.value = percent;
    percentage.textContent = `${percent}%`;
    if (phase.textContent !== message) phase.textContent = message;
  };
  dialog.addEventListener('cancel', event => { if (done.disabled) event.preventDefault(); });
  const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
  dialog.showModal();
  let timer;
  let finished = false;
  async function poll() {
    try {
      const status = await source.applyStatus(token);
      if (!finished) update(status);
    } catch {
      // Keep waiting for the Apply response if a progress read fails.
    }
    if (!finished) timer = setTimeout(poll, 300);
  }
  timer = setTimeout(poll, 150);
  const stopPolling = () => { finished = true; clearTimeout(timer); };
  try {
    const result = await source.project('apply', { ...options, progress: token });
    stopPolling();
    if (preview) dialog.close();
    else {
      wait.hidden = true;
      update({percent: 100, message: 'Project applied. You can now launch the game.'});
      done.disabled = false;
      done.focus();
    }
    await closed;
    return result;
  } catch (error) {
    stopPolling();
    dialog.querySelector('h2').textContent = preview ? 'Could not prepare Apply preview' : 'Apply could not finish';
    phase.textContent = error.message;
    if (wait) wait.hidden = true;
    done.disabled = false;
    done.textContent = 'Close';
    done.focus();
    await closed;
    return null;
  } finally {
    dialog.remove();
  }
}
