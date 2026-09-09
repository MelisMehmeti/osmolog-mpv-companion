"use strict";
const LANGUAGE_NAMES = { ja:"Japanese", en:"English", sv:"Swedish", es:"Spanish", fr:"French", de:"German", ko:"Korean", zh:"Chinese", ar:"Arabic", bg:"Bulgarian", cs:"Czech", da:"Danish", nl:"Dutch", fi:"Finnish", el:"Greek", hu:"Hungarian", id:"Indonesian", it:"Italian", no:"Norwegian", pl:"Polish", pt:"Portuguese", ro:"Romanian", ru:"Russian", th:"Thai", tr:"Turkish", uk:"Ukrainian", vi:"Vietnamese" };
const PLAYERS = { mpv:"MPV", steam:"Steam", manatan:"Manatan" };
const byId = id => document.getElementById(id), api = window.osmolog;
const { duration, mode, connection } = CompanionView;
let state = { ready:false }, page = "home", viewKey = "", busy = false, syncing = false, lastSyncAt = 0;
const { icon, dot, secondaryButton, toggle, select, row, section, tab, integration, languageChip, emptyState } = CompanionUi;
const languages = fallback => `${fallback?`<option value="">${fallback}</option>`:''}${Object.entries(LANGUAGE_NAMES).map(([c,l])=>`<option value="${c}">${l}</option>`).join('')}`;
const switchRow = (key,label,help='') => row({label,help,forId:key,control:toggle(key)});
const languageRow = (id,label,fallback='',help='Choose which language receives tracked time.') => row({label,help,forId:id,control:select(id,languages(fallback))});
function text(id,v){const el=byId(id);if(el&&el.textContent!==String(v))el.textContent=v;}
function value(id,v){const el=byId(id);if(el&&document.activeElement!==el)el.value=v;}
function checked(id,v){const el=byId(id);if(el)el.checked=v===true;}
function notify(message){text('feedback',message||'');byId('feedback').hidden=!message;}
byId('connections').innerHTML=Object.entries(PLAYERS).map(([player,label])=>integration(player,label)).join('');
function todayTemplate(){
  return `<section class="today-panel" aria-label="Today's tracking and synchronization"><div class="today-total"><h2>TODAY</h2><div class="today-value"><strong id="todayTime"></strong>${languageChip('todayLanguage')}</div></div><div class="today-actions">${secondaryButton('sync','Sync now','syncNow')}<span id="lastSyncStatus" class="sync-detail" role="status"></span><button type="button" class="text-button" data-action="dashboard">Open dashboard ↗</button></div></section>`;
}
function homeTemplate(){
  const session = !state.fileLoaded ? emptyState() : `<section class="session-panel session"><div class="session-heading"><span id="sourceLabel"></span><span id="modeLabel" class="mode-label"></span></div><div class="session-main"><i id="activityCircle" class="activity-circle" aria-hidden="true"></i><div class="session-details"><h1 id="mediaTitle"></h1><div id="fileTime" class="timer"></div><div class="time-split"><span><i class="green"></i>Active <b id="activeTime"></b></span><span><i class="amber"></i>Passive <b id="passiveTime"></b></span></div><div class="split-bar" aria-hidden="true"><i id="activeTrack"></i><i id="passiveTrack"></i></div></div></div><div class="session-language">${languageRow('sessionLanguage','Count time toward','Choose language','')}</div><div class="session-actions"><button id="pauseButton" class="secondary" data-action="pause">Pause tracking</button></div></section>`;
  return session+todayTemplate();
}
function settingsTemplate(){
  const navigation=`<div class="settings-title"><button type="button" class="icon-button back" data-page="home" aria-label="Back to session">‹</button><h1>Settings</h1></div><nav class="settings-tabs" aria-label="Settings pages">${Object.entries({general:'General',...PLAYERS}).map(([key,label])=>tab(key,label,page===key)).join('')}</nav>`;
  if(page==='general')return navigation+section('Startup',
    switchRow('startWithWindows','Start with Windows','Run Companion in the background when you sign in.')+
    switchRow('startMinimized','Start minimized','Open silently in the system tray.')+
    switchRow('keepInTray','Keep Companion in system tray','Closing the window keeps tracking active.')
  )+section('Preferences',
    languageRow('defaultLanguage','Default tracking language','','Used when an integration does not specify a language.')+
    row({label:'App updates',help:`<span class="inline-status">${dot('settingsUpdateDot')}<span id="settingsUpdateStatus"></span></span><progress id="settingsUpdateProgress" max="100" hidden></progress>`,control:`<div class="setting-actions">${secondaryButton('check','Check for updates','checkUpdates')}<button id="settingsRestartUpdate" class="secondary" data-action="restart" hidden>Restart to update</button></div>`})
  );
  const instructions={mpv:'Open MPV to connect automatically.',steam:'Open a game to connect automatically.',manatan:'Open a video in Manatan to connect automatically.'};
  const connectionRow=`<div class="setting-row player-status"><div class="player-status-copy">${icon(page)}<div class="setting-copy"><b id="playerStatus"></b><small id="playerConnectionHelp">${instructions[page]}</small></div></div>${dot('playerStatusDot')}</div>`;
  const openHelp={mpv:'Show the window when MPV connects.',steam:'Show the window when a game is detected.',manatan:'Show the window when a video is detected.'};
  const setup=page==='mpv'?row({label:'MPV setup',help:'<span id="mpvSetupStatus"></span>',control:secondaryButton('setup','Configure')}):page==='steam'?row({id:'steamEnableRow',hidden:true,label:'Steam is not set up yet',help:'Detect games from your local Steam library.',control:secondaryButton('enableSteam','Set up Steam')}):'';
  const steamRows=page==='steam'?row({label:'Pause after no input',help:'Stop counting when you have been inactive.',forId:'steamIdle',control:select('steamIdle',[0,60,120,300,600,900,1800,3600].map(seconds=>`<option value="${seconds}">${seconds?`${seconds/60} ${seconds===60?'minute':'minutes'}`:'Never'}</option>`).join(''))})+
    row({id:'steamGameRow',hidden:true,label:'<span id="steamTitle"></span>',help:'<span id="steamReason"></span>',control:secondaryButton('steamPause','Pause tracking','steamPause')})+`<div id="steamExcludedRow" hidden>${switchRow('steamExcluded','Exclude this game')}</div>`:'';
  return navigation+section('Connection',connectionRow+switchRow('openWithPlayer',`Open Companion with ${PLAYERS[page]}`,openHelp[page])+setup)+section('Tracking',languageRow('playerLanguage',page==='steam'?'Count game time toward':'Count video time toward',page==='steam'?'Suggested by Steam':'Use general default')+steamRows);
}
function render(next){
  state=next?{...state,...next}:state;
  const key=`${page}:${page==='home'&&state.fileLoaded}`;
  if(key!==viewKey){byId('pageContent').innerHTML=page==='home'?homeTemplate():settingsTemplate();viewKey=key;}
  byId('connections').hidden=page!=='home';
  for(const p of Object.keys(PLAYERS)){const s=connection(state.players?.[p]),el=byId(`${p}Connection`);el.className=s.color;el.querySelector('span').textContent=s.label;el.querySelector('i').className=`status-dot ${s.color}`;el.closest('.connection').classList.toggle('is-idle',s.label==='Idle');el.closest('.connection').classList.toggle('is-detected',s.color==='detected');}
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
  const language=LANGUAGE_NAMES[state.languageCode]||'Choose language';
  text('todayLanguage',language);text('todayTime',duration(state.todaySeconds));
  const minutesSinceSync=Math.max(0,Math.floor((Date.now()-lastSyncAt)/60000));
  text('lastSyncStatus',syncing?'Syncing…':state.pendingSegments?`${state.pendingSegments} waiting to sync`:lastSyncAt?`Last synced ${minutesSinceSync?`${minutesSinceSync} min ago`:'just now'}`:state.extensionConnected?'All activity synced':'Saved on this computer');
  if(byId('syncNow')){byId('syncNow').disabled=busy||syncing;text('syncNow',syncing?'Syncing…':'Sync now');}
  text('idleTitle',state.ready?'No media detected':state.fatalError?'Could not start':'Getting ready');text('idleCopy',state.fatalError||(state.ready?'Open MPV, Steam, or Manatan to begin tracking.':'Connecting the local tracker…'));
  for(const key of ['startWithWindows','startMinimized','keepInTray'])checked(key,state.desktop?.[key]);
  value('defaultLanguage',state.defaultLanguage||'ja');checked('openWithPlayer',state.desktop?.openWith?.[page]);
  const playerState=state.players?.[page]||{},s=connection(playerState);
  const waitingInstructions={mpv:'Open MPV to connect automatically.',steam:'Open a game to connect automatically.',manatan:'Open a video in Manatan to connect automatically.'};
  text('playerStatus',s.color==='error'||s.color==='attention'?`${PLAYERS[page]} · ${s.label}`:`${s.label==='Idle'?'Waiting for':s.label==='Now tracking'?'Now tracking in':'Connected to'} ${PLAYERS[page]||''}`);
  text('playerConnectionHelp',playerState.error||((s.label==='Connected'||s.label==='Now tracking')?'Tracking settings for this integration.':waitingInstructions[page]||''));
  if(byId('playerStatusDot'))byId('playerStatusDot').className=`status-dot ${s.color}`;
  value('playerLanguage',state.playerLanguages?.[page]||'');
  text('mpvSetupStatus',state.autoLaunchStatus==='error'?state.autoLaunchMessage:(playerState.connected||state.mpvConfigDirectoryDetected)?'MPV is configured. Restart MPV after setup.':'Configure MPV to connect automatically.');
  const steam=state.steam||{};
  if(page==='steam'){
    const idle=String(steam.idleThresholdSeconds??300);if(![...byId('steamIdle').options].some(o=>o.value===idle))byId('steamIdle').add(new Option(`${Number(idle)/60} minutes`,idle));value('steamIdle',idle);
    byId('steamEnableRow').hidden=steam.enabled===true;byId('steamGameRow').hidden=!steam.appId;byId('steamExcludedRow').hidden=!steam.appId;
    text('steamTitle',steam.title||'Steam game');text('steamReason',steam.error||mode(steam).label);checked('steamExcluded',steam.excluded);text('steamPause',steam.manualPaused?'Resume tracking':'Pause tracking');
  }
  if(busy)for(const el of document.querySelectorAll('#pageContent button, #pageContent input, #pageContent select'))el.disabled=true;
  renderUpdate();text('compactTime',duration(state.sessionSeconds));text('compactLanguage',language.toUpperCase());byId('compactDot').className=activity.color;
}
function renderUpdate(){
  const u=state.updateStatus||{},v=u.version?` ${u.version}`:'';
  const headings={downloading:`Downloading update${v}`,ready:`Update${v} ready · restart required`,preparing:'Saving your activity…',installing:`Installing update${v}…`,error:'Could not update Companion'};
  const messages={downloading:`${Number.isFinite(u.percent)?u.percent+'% · ':''}You can keep tracking while it downloads.`,ready:'Restart to install. Your activity will be saved. Closing × only hides Companion.',preparing:'Preparing to close Companion safely.',installing:'Companion will reopen when installation finishes.',error:'Try checking again in Settings.',portable:'Portable version · download updates manually from GitHub Releases.',disabled:'Automatic updates require the installed version.',checking:'Checking for updates…',current:'Up to date',idle:'Updates download automatically.'};
  byId('updateBanner').hidden=page==='general'||!headings[u.state];byId('updateBanner').className=`update-banner ${u.state==='downloading'?'downloading':u.state==='error'?'error':''}`;
  text('updateHeading',headings[u.state]||'');text('updateStatus',messages[u.state]||'');
  byId('restartUpdateButton').hidden=!['ready','preparing','installing'].includes(u.state);byId('restartUpdateButton').disabled=busy||u.state!=='ready';
  for(const id of ['updateProgress','settingsUpdateProgress'])if(byId(id)){
    byId(id).hidden=u.state!=='downloading';if(Number.isFinite(u.percent))byId(id).value=u.percent;else byId(id).removeAttribute('value');
  }
  text('settingsUpdateStatus',headings[u.state] ? `${headings[u.state]}${u.state==='downloading'&&Number.isFinite(u.percent)?` · ${u.percent}%`:''}` : messages[u.state]||'Update status not available');
  if(byId('settingsUpdateDot'))byId('settingsUpdateDot').className=`status-dot ${u.state==='current'?'success':u.state==='error'?'error':['ready','portable','disabled'].includes(u.state)?'attention':['checking','downloading','preparing','installing'].includes(u.state)?'detected':'waiting'}`;
  if(byId('checkUpdates')){
    const restarting=['ready','preparing','installing'].includes(u.state);
    byId('checkUpdates').hidden=restarting;
    byId('checkUpdates').disabled=busy||['portable','disabled','checking','downloading', 'ready','preparing','installing'].includes(u.state);
    text('checkUpdates',u.state==='checking'?'Checking…':u.state==='downloading'?'Downloading…':'Check for updates');
    byId('settingsRestartUpdate').hidden=!restarting;byId('settingsRestartUpdate').disabled=busy||u.state!=='ready';
  }
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
  if(nextPage){if(!busy){page=nextPage;notify('');render();if(e.detail===0)document.querySelector(page==='home'?'#settingsButton':'.settings-tabs .selected')?.focus();}return;}
  if(action==='dashboard')void run(async()=>({ok:await api.openDashboard(),message:'Open Osmolog in Chrome to view your dashboard.'}));
  if(action==='sync')void run(async()=>{syncing=true;render();try{const result=await api.syncNow();if(result?.ok===true){lastSyncAt=Date.now();return {...result,message:''};}return result;}finally{syncing=false;}});
  if(action==='pause')void run(()=>api.setTrackingPaused(state.player,!state.players?.[state.player]?.manualPaused,state.sessionId));
  if(action==='steamPause')void run(()=>api.setTrackingPaused('steam',!state.steam.manualPaused,state.steam.sessionId));
  if(action==='setup')void run(()=>api.setupMpv());
  if(action==='enableSteam')void run(()=>api.configureSteam({enabled:true}),'Steam is ready. Open a game to begin tracking.');
  if(action==='check')void run(()=>api.checkForUpdates());
  if(action==='restart')void run(()=>api.restartForUpdate());
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
