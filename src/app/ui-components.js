"use strict";
(function(root) {
  const icon = player => `<img class="source-icon" src="../../assets/${player}.${player === 'manatan' ? 'png' : 'svg'}" alt="">`;
  const dot = (id = '', color = 'waiting') => `<i ${id ? `id="${id}"` : ''} class="status-dot ${color}" aria-hidden="true"></i>`;
  const secondaryButton = (action, label, id = '') => `<button type="button" class="secondary" data-action="${action}" ${id ? `id="${id}"` : ''}>${label}</button>`;
  const toggle = key => `<input class="switch" id="${key}" type="checkbox" role="switch" data-setting="${key}">`;
  const select = (id, options) => `<select id="${id}">${options}</select>`;
  const row = ({label, help = '', control = '', forId = '', id = '', hidden = false, className = ''}) => {
    const tag = forId ? 'label' : 'div';
    return `<div class="setting-row ${className}" ${id ? `id="${id}"` : ''} ${hidden ? 'hidden' : ''}><${tag} class="setting-copy" ${forId ? `for="${forId}"` : ''}><b>${label}</b>${help ? `<small>${help}</small>` : ''}</${tag}>${control}</div>`;
  };
  const section = (title, content) => `<section class="settings-section" aria-label="${title}"><h2>${title}</h2>${content}</section>`;
  const tab = (key, label, selected) => `<button type="button" data-page="${key}" ${selected ? 'class="selected" aria-current="page"' : ''}>${key === 'general' ? '<span class="settings-gear" aria-hidden="true">⚙</span>' : icon(key)}<span>${label}</span></button>`;
  const integration = (player, label) => `<button type="button" class="connection is-idle" data-page="${player}">${icon(player)}<span><b>${label}</b><small id="${player}Connection" class="waiting">${dot()}<span>Idle</span></small></span></button>`;
  const languageChip = id => `<span id="${id}" class="language-chip"></span>`;
  const emptyState = () => `<section class="session-panel idle-state"><svg class="empty-play" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/><path d="M20 16 32 24 20 32Z"/></svg><h1 id="idleTitle">No media detected</h1><p id="idleCopy">Start playback in MPV or Manatan, or launch a Steam game.</p></section>`;
  root.CompanionUi = { icon, dot, secondaryButton, toggle, select, row, section, tab, integration, languageChip, emptyState };
})(globalThis);
