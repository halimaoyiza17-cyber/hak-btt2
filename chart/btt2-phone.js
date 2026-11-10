/* Phone analysis mode. Desktop controls and data stay independent. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id), mobile=()=>matchMedia('(max-width:900px)').matches;
 const phoneButton=(id,label,text)=>{const b=document.createElement('button');b.id=id;b.type='button';b.className='phone-action';b.textContent=text;b.title=label;b.setAttribute('aria-label',label);$('topbar').append(b);return b;};
 const tools=phoneButton('phoneToolsToggle','Drawing tools','✎');
 const watch=phoneButton('phoneWatchToggle','Watchlist','☷');
 const replay=phoneButton('phoneReplayToggle','Replay controls','▷');
 const full=phoneButton('phoneFullscreen','Enter fullscreen','⛶');
 const more=phoneButton('phoneWorkspaceMenu','Workspace menu','⋯');tools.setAttribute('aria-expanded','false');replay.setAttribute('aria-expanded','false');
 const body=document.body;
 function closeControls(){body.classList.remove('phone-options-open','phone-tools-open');tools.setAttribute('aria-expanded','false');}
 function closePanels(){closeControls();$('rightDock').classList.remove('mobile-open');}
 tools.onclick=()=>{const open=!body.classList.contains('phone-tools-open');closeControls();$('rightDock').classList.remove('mobile-open');body.classList.toggle('phone-tools-open',open);tools.setAttribute('aria-expanded',String(open));};
 watch.onclick=()=>{closeControls();$('rail-watchlist').click();};
 replay.onclick=()=>{body.classList.toggle('phone-replay-open');replay.setAttribute('aria-expanded',String(body.classList.contains('phone-replay-open')));};
 async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else window.BTT2UI.toast('Fullscreen is unavailable in this browser. Try Add to Home screen.');}catch(_){window.BTT2UI.toast('Fullscreen was blocked by the browser. Try its fullscreen or Add to Home screen option.');}}
 full.onclick=toggleFullscreen;
 document.addEventListener('fullscreenchange',()=>{const on=!!document.fullscreenElement;full.setAttribute('aria-label',on?'Exit fullscreen':'Enter fullscreen');full.setAttribute('aria-pressed',String(on));});
 const done=document.createElement('button');done.id='phoneControlsDone';done.type='button';done.textContent='Draw ✓';done.setAttribute('aria-label','Close drawing controls and use chart');done.onclick=closeControls;$('phoneToolStrip').append(done);
 document.querySelectorAll('.draw-btn[data-tool]').forEach(b=>b.addEventListener('click',()=>{if(!mobile())return;body.classList.remove('phone-tools-open');tools.setAttribute('aria-expanded','false');body.classList.toggle('phone-options-open',!['cursor','observation'].includes(b.dataset.tool));}));
 // Close before the gesture is measured, without changing chart height under a finger.
 // Drawing controls close via Draw; no pointerdown layout change is required.
 window.addEventListener('btt2-cancel-tool',closeControls);
 window.addEventListener('btt2-selection',()=>{done.textContent=Store.selected()?'Done ✓':'Draw ✓';});
 window.addEventListener('btt2-chart-change',()=>{if(mobile())closePanels();});
 const originalItem=makeWlItem;
 makeWlItem=function(symbol,section){const row=originalItem(symbol,section);row.addEventListener('click',e=>{if(mobile()&&!e.target.closest('button,.wl-star,input'))window.BTT2UI.setDock('watchlist',false);});return row;};
 const searchBox=document.createElement('div');searchBox.id='phoneWatchSearch';searchBox.innerHTML='<input type="search" id="phonePairSearch" placeholder="Search pairs" aria-label="Search watchlist pairs"><span id="phonePairCount" role="status"></span>';$('watchlist').before(searchBox);
 function filterPairs(){const query=$('phonePairSearch').value.trim().toLowerCase();const matches=new Set();for(const row of $('watchlist').querySelectorAll('.wl-item')){const match=!query||row.dataset.symbol.toLowerCase().includes(query);row.hidden=!match;if(match)matches.add(row.dataset.symbol);}for(const h of $('watchlist').querySelectorAll('h4,.wl-empty')){h.hidden=!!query;if(h.tagName==='H4')h.classList.toggle('phone-empty-section',!!h.nextElementSibling?.classList.contains('wl-empty'));}$('phonePairCount').textContent=query?(matches.size?matches.size+' matching pair'+(matches.size===1?'':'s'):'No matching pairs'):'Scroll for more pairs ↓';}
 $('phonePairSearch').oninput=filterPairs;
 $('phonePairSearch').onkeydown=e=>{if(e.key==='Enter'){const row=$('watchlist').querySelector('.wl-item:not([hidden]) .wl-name');if(row){e.target.blur();row.click();}}};
 new MutationObserver(filterPairs).observe($('watchlist'),{childList:true});
 new MutationObserver(()=>{searchBox.hidden=$('objectTree').classList.contains('visible');}).observe($('objectTree'),{attributes:true,attributeFilter:['class']});
 more.onclick=()=>{
  const existing=$('phoneWorkspaceActions');if(existing){existing.remove();return;}
  closeControls();const panel=document.createElement('div');panel.id='phoneWorkspaceActions';panel.className='btt2-ui';panel.setAttribute('role','menu');
  const actions=[['Drawing controls / templates',()=>{const isSelected=!!Store.selected();if(!isSelected&&Interaction.tool==='cursor'){tools.click();return;}body.classList.add('phone-options-open');}],['Drawing settings',()=>{const s=Store.selected();if(s)window.BTT2UI.openProperties(s);else window.BTT2UI.toast('Select a drawing first');}],['Object tree',()=>$('rail-objects').click()],['Chart settings',()=>window.BTT2UI.chartSettings()],[HaksRanges.state().enabled?'HAKS: ON — turn OFF':'HAKS: OFF — turn ON',()=>$('btnHaksAnalysis').click()],['HAKS range settings',()=>window.BTT2UI.haksSettings()],['Refresh local CSVs',()=>$('btnRefreshData').click()],['Export workspace backup',()=>window.BTT2UI.exportWorkspace()],['Import workspace backup',()=>window.BTT2UI.importWorkspace()],['Undo',()=>$('btnUndo').click()],['Redo',()=>$('btnRedo').click()],['Reset chart view',()=>window.BTT2UI.resetView()],['Close menu',()=>{}]];
  for(const [label,run]of actions){const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('role','menuitem');b.onclick=()=>{panel.remove();run();};panel.append(b);}document.body.append(panel);
 };
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#phoneWorkspaceActions,#phoneWorkspaceMenu'))$('phoneWorkspaceActions')?.remove();},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeControls();$('phoneWorkspaceActions')?.remove();}});
 window.addEventListener('resize',()=>{if(!mobile()){closeControls();$('phoneWorkspaceActions')?.remove();}});
 filterPairs();
 window.BTT2Phone={closeControls,toggleFullscreen,filterPairs};
})();
