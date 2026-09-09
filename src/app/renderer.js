"use strict";
const LANGUAGE_NAMES = { ja:"Japanese", en:"English", sv:"Swedish", es:"Spanish", fr:"French", de:"German", ko:"Korean", zh:"Chinese", ar:"Arabic", bg:"Bulgarian", cs:"Czech", da:"Danish", nl:"Dutch", fi:"Finnish", el:"Greek", hu:"Hungarian", id:"Indonesian", it:"Italian", no:"Norwegian", pl:"Polish", pt:"Portuguese", ro:"Romanian", ru:"Russian", th:"Thai", tr:"Turkish", uk:"Ukrainian", vi:"Vietnamese" };
const PLAYERS = { mpv:"MPV", steam:"Steam", manatan:"Manatan" };
const byId = id => document.getElementById(id), api = window.osmolog;
const { duration, mode, connection } = CompanionView;
let state = { ready:false }, page = "home", viewKey = "", busy = false;
const icon = p => `<img class="source-icon" src="../../assets/${p}.${p==='manatan'?'png':'svg'}" alt="">`;
const languages = fallback => `${fallback?`<option value="">${fallback}</option>`:''}${Object.entries(LANGUAGE_NAMES).map(([c,l])=>`<option value="${c}">${l}</option>`).join('')}`;
const switchRow = (key,label,help='') => `<div class="setting-row"><label for="${key}"><b>${label}</b>${help?`<small>${help}</small>`:''}</label><input class="switch" id="${key}" type="checkbox" role="switch" data-setting="${key}"></div>`;
const languageRow = (id,label,fallback='') => `<div class="setting-row"><label for="${id}"><b>${label}</b><small>The language your immersion time is recorded under.</small></label><select id="${id}">${languages(fallback)}</select></div>`;
function text(id,v){const el=byId(id);if(el&&el.textContent!==String(v))el.textContent=v;}
function value(id,v){const el=byId(id);if(el&&document.activeElement!==el)el.value=v;}
function checked(id,v){const el=byId(id);if(el)el.checked=v===true;}
function notify(message){text('feedback',message||'');byId('feedback').hidden=!message;}
byId('connections').innerHTML=Object.entries(PLAYERS).map(([p,l])=>`<button class="connection" data-page="${p}">${icon(p)}<span><b>${l}</b><small id="${p}Connection"><i></i><span>Waiting</span></small></span></button>`).join('');
function homeTemplate(){
  if(!state.fileLoaded)return `<section class="idle-state"><div class="idle-symbol">${Object.keys(PLAYERS).map(icon).join('')}</div><h1 id="idleTitle">Ready when you are</h1><p id="idleCopy"></p></section><div class="today"><span id="todayLabel">OSMOLOG TODAY</span><strong id="todayTime">0s</strong></div><div class="home-actions"><button class="secondary" data-action="sync">Sync now</button><button class="text-button" data-action="dashboard">Open dashboard ↗</button></div>`;
  return `<section class="session"><div class="session-heading"><span id="sourceLabel"></span><span id="modeLabel" class="mode-label"></span></div><div class="session-main"><i id="activityCircle" class="activity-circle"></i><div class="session-details"><h1 id="mediaTitle"></h1><div id="fileTime" class="timer">0s</div><div class="time-split"><span><i class="green"></i>Active <b id="activeTime">0s</b></span><span><i class="amber"></i>Passive <b id="passiveTime">0s</b></span></div><div class="split-bar"><i id="activeTrack"></i><i id="passiveTrack"></i></div></div></div></section><div class="session-language">${languageRow('sessionLanguage','Count time toward','Choose language')}</div><div class="home-actions"><button id="pauseButton" class="primary" data-action="pause">Ⅱ Pause tracking</button><span id="syncStatus" class="saved"></span><button class="text-button" data-action="dashboard" aria-label="Open Osmolog dashboard">↗</button></div>`;
}
function settingsTemplate(){
  const tabs=`<div class="settings-title"><button class="icon-button back" data-page="home" aria-label="Back to session">‹</button><h1>Settings</h1></div><nav class="settings-tabs" aria-label="Settings pages">${Object.entries({general:'General',...PLAYERS}).map(([key,label])=>`<button data-page="${key}" ${page===key?'class="selected" aria-current="page"':''}>${key==='general'?'<span>⚙</span>':icon(key)}${label}</button>`).join('')}</nav>`;
  if(page==='general')return tabs+`<div class="settings-content">${switchRow('startWithWindows','Start with Windows','Run Companion in the background when you sign in.')}${switchRow('startMinimized','Start minimized')}${switchRow('keepInTray','Keep Companion in the system tray','Closing the window keeps tracking. Turn off to quit on close.')}${languageRow('defaultLanguage','Default language to count toward')}<div class="setting-row"><div><b>Updates</b><small id="settingsUpdateStatus"></small></div><button id="checkUpdates" class="secondary" data-action="check">Check for updates</button></div></div>`;
  return tabs+`<div class="settings-content"><div class="setting-row player-status"><div>${icon(page)}<b id="playerStatus"></b></div><i id="playerStatusDot" class="status-dot"></i></div>${switchRow('openWithPlayer',`Open Companion with ${PLAYERS[page]}`,page==='mpv'?'Launch with MPV and show the window when it connects.':'Show the window when detected. Keep Companion running in the tray.')}${page==='mpv'?'<div class="setting-row"><div><b>MPV setup</b><small id="mpvSetupStatus"></small></div><button class="secondary" data-action="setup">Set up MPV</button></div>':''}${languageRow('playerLanguage',page==='steam'?'Count game time toward':'Count video time toward',page==='steam'?'Suggested by Steam':'Use general default')}${page==='steam'?'<div class="setting-row"><label for="steamIdle">Pause after no input</label><select id="steamIdle"><option value="0">Never</option><option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option><option value="600">10 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option><option value="3600">60 minutes</option></select></div><div id="steamEnableRow" class="setting-row" hidden><div><b>Steam is not set up yet</b><small>Detect games from your local Steam library.</small></div><button class="secondary" data-action="enableSteam">Set up Steam</button></div><div id="steamGameRow" class="setting-row" hidden><div><b id="steamTitle"></b><small id="steamReason"></small></div><button id="steamPause" class="secondary" data-action="steamPause">Pause tracking</button></div><div id="steamExcludedRow" hidden>'+switchRow('steamExcluded','Exclude this game')+'</div>':''}${page==='manatan'?'<p class="connection-help" id="manatanHelp"></p>':''}</div>`;
}
function render(next){
  state=next?{...state,...next}:state;
  const key=`${page}:${page==='home'&&state.fileLoaded}`;
  if(key!==viewKey){byId('pageContent').innerHTML=page==='home'?homeTemplate():settingsTemplate();viewKey=key;}
  byId('connections').hidden=page!=='home';
  for(const p of Object.keys(PLAYERS)){const s=connection(state.players?.[p]),el=byId(`${p}Connection`);el.className=s.color;el.querySelector('span').textContent=s.label;}
  byId('connectionBanner').hidden=state.extensionConnected===true;
  text('connectionMessage',state.fatalError||(!state.ready?'Starting Companion…':state.paired?'Reconnecting to Osmolog…':'Connect to Osmolog to sync your time'));
  byId('pairButton').disabled=busy||!state.ready;
  text('appVersion',`Companion v${state.appVersion||'…'}`);
  byId('closeButton').setAttribute('aria-label',state.desktop?.keepInTray===false?'Quit Companion':'Close to system tray');
  const playback=state.players?.[state.player]||state,activity=mode(playback);
  text('sourceLabel',`${PLAYERS[state.player]||'MPV'} SESSION`);text('mediaTitle',state.title||'Untitled session');text('fileTime',duration(state.sessionSeconds));text('activeTime',duration(state.sessionActiveSeconds));text('passiveTime',duration(state.sessionPassiveSeconds));text('modeLabel',activity.label);
  if(byId('activityCircle')){byId('activityCircle').className=`activity-circle ${activity.color}`;byId('modeLabel').className=`mode-label ${activity.color}`;}
  const total=(state.sessionActiveSeconds||0)+(state.sessionPassiveSeconds||0);
  if(byId('activeTrack')){byId('activeTrack').style.width=`${total?100*state.sessionActiveSeconds/total:0}%`;byId('passiveTrack').style.width=`${total?100*state.sessionPassiveSeconds/total:0}%`;}
  value('sessionLanguage',state.languageCode||'');text('pauseButton',playback.manualPaused?'▶ Resume tracking':'Ⅱ Pause tracking');
  text('syncStatus',state.pendingSegments?`${state.pendingSegments} waiting to sync`:state.extensionConnected?'✓ All activity synced':'Saved on this computer');
  const language=LANGUAGE_NAMES[state.languageCode]||'Choose language';
  text('todayLabel',`OSMOLOG TODAY · ${language}`);text('todayTime',duration(state.todaySeconds));
  text('idleTitle',state.ready?'Ready when you are':state.fatalError?'Could not start':'Getting ready');text('idleCopy',state.fatalError||(state.ready?'Play a video or open a game. Your session will appear here.':'Connecting the local tracker…'));
  for(const key of ['startWithWindows','startMinimized','keepInTray'])checked(key,state.desktop?.[key]);
  value('defaultLanguage',state.defaultLanguage||'ja');checked('openWithPlayer',state.desktop?.openWith?.[page]);
  const s=connection(state.players?.[page]);text('playerStatus',`${s.label==='Waiting'?'Waiting for':s.label==='Now tracking'?'Now tracking in':'Connected to'} ${PLAYERS[page]||''}`);
  if(byId('playerStatusDot'))byId('playerStatusDot').className=`status-dot ${s.color}`;
  value('playerLanguage',state.playerLanguages?.[page]||'');
  text('mpvSetupStatus',state.autoLaunchStatus==='error'?state.autoLaunchMessage:state.mpvConfigDirectoryDetected?'MPV configured. Restart MPV after setup.':'Configure MPV to connect automatically.');
  const steam=state.steam||{};
  if(page==='steam'){
    const idle=String(steam.idleThresholdSeconds??300);if(![...byId('steamIdle').options].some(o=>o.value===idle))byId('steamIdle').add(new Option(`${Number(idle)/60} minutes`,idle));value('steamIdle',idle);
    byId('steamEnableRow').hidden=steam.enabled===true;byId('steamGameRow').hidden=!steam.appId;byId('steamExcludedRow').hidden=!steam.appId;
    text('steamTitle',steam.title||'Steam game');text('steamReason',steam.error||mode(steam).label);checked('steamExcluded',steam.excluded);text('steamPause',steam.manualPaused?'Resume tracking':'Pause tracking');
  }
  if(page==='manatan')text('manatanHelp',state.players?.manatan?.error||(state.manatanConnected?'Manatan is connected. Open a video to begin.':'Open a video in Manatan to connect automatically.'));
  renderUpdate();text('compactTime',duration(state.sessionSeconds));text('compactLanguage',language.toUpperCase());byId('compactDot').className=activity.color;
}
function renderUpdate(){
  const u=state.updateStatus||{},v=u.version?` ${u.version}`:'';
  const headings={downloading:`Downloading update${v}`,ready:`Update${v} ready · restart required`,preparing:'Saving your activity…',installing:`Installing update${v}…`,error:'Could not update Companion'};
  const messages={downloading:`${Number.isFinite(u.percent)?u.percent+'% · ':''}You can keep tracking while it downloads.`,ready:'Restart to install. Your activity will be saved. Closing × only hides Companion.',preparing:'Preparing to close Companion safely.',installing:'Companion will reopen when installation finishes.',error:'Try checking again in Settings.',portable:'Portable version · download updates manually from GitHub Releases.',disabled:'Automatic updates require the installed version.',checking:'Checking for updates…',current:'Companion is up to date.',idle:'Updates download automatically.'};
  byId('updateBanner').hidden=!headings[u.state];byId('updateBanner').className=`update-banner ${u.state==='downloading'?'downloading':u.state==='error'?'error':''}`;
  text('updateHeading',headings[u.state]||'');text('updateStatus',messages[u.state]||'');
  byId('restartUpdateButton').hidden=!['ready','preparing','installing'].includes(u.state);byId('restartUpdateButton').disabled=busy||u.state!=='ready';
  byId('updateProgress').hidden=u.state!=='downloading';if(Number.isFinite(u.percent))byId('updateProgress').value=u.percent;else byId('updateProgress').removeAttribute('value');
  text('versionStatus',headings[u.state]?'Updating…':u.state==='current'?'Up to date':u.state==='portable'?'Portable edition':u.state==='disabled'?'Development version':messages[u.state]||'');text('settingsUpdateStatus',messages[u.state]||'');
  if(byId('checkUpdates'))byId('checkUpdates').disabled=busy||['portable','disabled','checking','downloading','ready','preparing','installing'].includes(u.state);
}
async function run(operation,success){
  if(busy)return;busy=true;
  for(const el of document.querySelectorAll('#pageContent button, #pageContent input, #pageContent select, #pairButton'))el.disabled=true;
  try{const result=await operation();if(result?.state)render(result.state);notify(result?.ok===false?(result.message||'Could not save. Please try again.'):success||result?.message||'');}
  catch{notify('Could not complete this action. Please try again.');}
  finally{busy=false;for(const el of document.querySelectorAll('#pageContent button, #pageContent input, #pageContent select'))el.disabled=false;render();}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;const {page:nextPage,action}=b.dataset;
  if(nextPage){if(!busy){page=nextPage;notify('');render();}return;}
  if(action==='dashboard')void run(async()=>({ok:await api.openDashboard(),message:'Open Osmolog in Chrome to view your dashboard.'}));
  if(action==='sync')void run(()=>api.syncNow());
  if(action==='pause')void run(()=>api.setTrackingPaused(state.player,!state.players?.[state.player]?.manualPaused,state.sessionId));
  if(action==='steamPause')void run(()=>api.setTrackingPaused('steam',!state.steam.manualPaused,state.steam.sessionId));
  if(action==='setup')void run(()=>api.setupMpv());
  if(action==='enableSteam')void run(()=>api.configureSteam({enabled:true}),'Steam is ready. Open a game to begin tracking.');
  if(action==='check')void run(()=>api.checkForUpdates());
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.setting==='openWithPlayer')void run(()=>api.configureDesktop({openWith:{[page]:el.checked}}));
  else if(el.dataset.setting==='steamExcluded')void run(()=>api.configureSteam({appId:state.steam.appId,excluded:el.checked}));
  else if(el.dataset.setting)void run(()=>api.configureDesktop({[el.dataset.setting]:el.checked}));
  if(el.id==='sessionLanguage')void run(()=>api.setPlayerLanguage(state.player,el.value,state.sessionId),'Tracking language saved.');
  if(el.id==='defaultLanguage')void run(()=>api.setPlayerLanguage('general',el.value),'Default tracking language saved.');
  if(el.id==='playerLanguage')void run(()=>api.setPlayerLanguage(page,el.value),'Tracking language saved for this player.');
  if(el.id==='steamIdle')void run(()=>api.configureSteam({idleSeconds:Number(el.value)}));
});
byId('settingsButton').addEventListener('click',()=>{if(!busy){page='general';notify('');render();}});
byId('minimizeButton').addEventListener('click',()=>api.windowAction("compact"));byId('closeButton').addEventListener('click',()=>api.windowAction("hide"));
byId('pairButton').addEventListener('click',()=>void run(async()=>{await api.startPairing();const opened=await api.openDashboard();return {ok:true,message:opened?'Osmolog opened. Allow Companion access if asked.':'Open Osmolog in Chrome and select Connect Companion.'};}));
byId('restartUpdateButton').addEventListener('click',()=>void run(()=>api.restartForUpdate()));
const compactOverlay=byId('compactOverlay');let compactDrag=null;
compactOverlay.addEventListener('pointerdown',e=>{if(e.button!==0)return;compactDrag={pointerId:e.pointerId,startX:e.screenX,startY:e.screenY,offsetX:e.clientX,offsetY:e.clientY,moved:false};compactOverlay.setPointerCapture(e.pointerId);});
compactOverlay.addEventListener('pointermove',e=>{if(!compactDrag||compactDrag.pointerId!==e.pointerId)return;if(Math.hypot(e.screenX-compactDrag.startX,e.screenY-compactDrag.startY)>=3)compactDrag.moved=true;if(compactDrag.moved)void api.windowAction("move",{x:e.screenX-compactDrag.offsetX,y:e.screenY-compactDrag.offsetY});});
compactOverlay.addEventListener('pointerup',e=>{if(!compactDrag||compactDrag.pointerId!==e.pointerId)return;const moved=compactDrag.moved;compactDrag=null;compactOverlay.releasePointerCapture(e.pointerId);if(!moved)void api.windowAction('expand');});
compactOverlay.addEventListener('pointercancel',()=>{compactDrag=null;});compactOverlay.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')void api.windowAction('expand');});
api.onState(render);api.onWindowMode(mode=>byId('appShell').dataset.mode=mode);api.getState().then(render).catch(()=>notify('Could not connect to Companion. Restart the app.'));
