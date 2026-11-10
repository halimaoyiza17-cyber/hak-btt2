/* Confirmed range chart integration. No orders or future-candle analysis. */
var HaksRanges = (() => {
 let lastClock=-Infinity, poiEngine=null, poiSource=null, requestCache=null, requests=new Map();
 let enabled=false, engine=null, source=null, tf=null, signature='', options={structure:'close',sweeps:'both',keepPivots:100,evidence:true,panel:true,selectedRanks:null};
 try{options={...options,...JSON.parse(localStorage.getItem('haks_ranges_options')||'{}')};enabled=localStorage.getItem('haks_ranges_on')==='true';}catch(_){}
 options.selectedRanks=normalizeRanks(options.selectedRanks);
 let eligibleCount=0;
 const button=document.getElementById('btnHaksAnalysis'), panel=document.getElementById('haksDashboard'), canvas=document.getElementById('haksCanvas');
 function updateButton(){button.textContent=enabled?'HAKS ON':'HAKS OFF';button.classList.toggle('on',enabled);button.setAttribute('aria-pressed',String(enabled));}
 panel.style.cssText='min-width:0;max-width:min(250px,65%);padding:4px 7px;border:0;box-shadow:none;backdrop-filter:none;background:var(--bg,#fff);opacity:.88;font-size:10px;line-height:1.3';
 button.title='Show or hide confirmed untouched ranges';
 button.onclick=()=>{enabled=!enabled;localStorage.setItem('haks_ranges_on',enabled);updateButton();draw();};
 const settings=document.createElement('details');settings.style.cssText='position:relative;font-size:12px;flex-shrink:0';
 settings.innerHTML='<summary style="cursor:pointer">Range settings</summary><div style="position:absolute;right:0;top:26px;width:230px;padding:12px;background:var(--bg,#fff);color:var(--text,#111);border:1px solid #888;z-index:1000;display:grid;gap:10px"><label>Structure <select id="hrStructure"><option value="close">Closing-price swings</option><option value="wick">Wick swings</option></select></label><label>Sweeps <select id="hrSweeps"><option value="both">Wicks or closes</option><option value="wick">Wicks only</option><option value="close">Closes only</option></select></label><label>Reference memory <input id="hrMemory" type="number" min="20" max="200" style="width:60px"></label><label><input id="hrEvidence" type="checkbox"> Show evidence</label><label><input id="hrPanel" type="checkbox"> Show status</label><small>H1 → Daily · H4 → Weekly · Daily/Weekly → Monthly. Only closed POI rejections qualify. Boundary touches retire ranges.</small></div>';
 button.after(settings);
 for(const [id,key] of [['hrStructure','structure'],['hrSweeps','sweeps'],['hrMemory','keepPivots'],['hrEvidence','evidence'],['hrPanel','panel']]){
  const el=document.getElementById(id);if(el.type==='checkbox')el.checked=options[key];else el.value=options[key];
  el.onchange=()=>{options[key]=el.type==='checkbox'?el.checked:key==='keepPivots'?Math.max(20,Math.min(200,Number(el.value)||100)):el.value;localStorage.setItem('haks_ranges_options',JSON.stringify(options));draw();};
 }
 const rangePicker=document.createElement('div');settings.querySelector('div').append(rangePicker);
 settings.addEventListener('toggle',()=>{if(settings.open)mountSelector(rangePicker);});
 function normalizeRanks(value){return value==null?null:[...new Set((Array.isArray(value)?value:[]).filter(n=>Number.isInteger(n)&&n>=1&&n<=100))].sort((a,b)=>a-b);}
 function mountSelector(container,onChange){
  function render(){
   container.replaceChildren();const title=document.createElement('h3');title.textContent='Ranges to show';container.append(title);
   const allLabel=document.createElement('label');allLabel.className='check';const all=document.createElement('input');all.type='checkbox';all.checked=options.selectedRanks==null;all.setAttribute('aria-label','Show all eligible ranges');allLabel.append(all,' Show all eligible ranges');container.append(allLabel);
   const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(68px,1fr));gap:8px;max-height:140px;overflow-y:auto;padding:4px';container.append(grid);
   const count=Math.max(eligibleCount,...(options.selectedRanks||[]),0);
   function change(value){configure({selectedRanks:value});onChange?.(state().selectedRanks);render();}
   all.onchange=()=>change(all.checked?null:[]);
   for(let n=1;n<=count;n++){
    const label=document.createElement('label');label.className='check';label.style.cssText='min-height:32px;display:flex;align-items:center;gap:6px';const input=document.createElement('input');input.type='checkbox';input.checked=options.selectedRanks==null||options.selectedRanks.includes(n);input.setAttribute('aria-label','Show R'+n);label.append(input,' R'+n);if(n>eligibleCount)label.title='Not currently eligible';grid.append(label);
    input.onchange=()=>{const selected=new Set(options.selectedRanks??Array.from({length:eligibleCount},(_,i)=>i+1));if(input.checked)selected.add(n);else selected.delete(n);change([...selected]);};
   }
   const note=document.createElement('small');note.textContent=(eligibleCount?'Select any combination.':'No eligible ranges on this chart yet.')+' Numbers follow the current newest-first ranking. Hidden ranges are still calculated.';container.append(note);
  }
  render();
 }
 function poiEnd(rows,i,key){
  if(i+1<rows.length)return rows[i+1].time;
  // Monthly/week exports can open on the preceding Sunday/local session.
  // Use a date inside the period to avoid treating a July-31 August open as July.
  const b=rows[i],d=new Date((b.time+(key==='1mo'?7*86400:key==='1w'?2*86400:0))*1000);
  if(key==='1mo')return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000;
  return candleEndTime(b,key,rows,i);
 }
 function poiAt(rows,t,key){let a=0,z=rows.length;while(a<z){const m=(a+z)>>1;if(rows[m].time<=t)a=m+1;else z=m;}const i=a-1;return i>=0&&t<poiEnd(rows,i,key)?rows[i].time:null;}
 function ensurePoi(symbol,key){
  if(requestCache!==app.cache){requestCache=app.cache;requests=new Map();}
  const id=symbol+'_'+key,rows=app.cache[id];if(rows)return rows;
  if(!requests.has(id)){const cache=app.cache;requests.set(id,{loading:true});loadCsv(symbol,key).then(()=>{if(cache!==app.cache)return;requests.set(id,{loading:false});draw();}).catch(e=>{if(cache!==app.cache)return;requests.set(id,{error:e.message});draw();});}
  const status=requests.get(id);panel.textContent=status?.error?'HAKS: '+key+' POI data unavailable. Add its CSV and Refresh Data.':'HAKS: loading '+key+' POI candles…';return null;
 }
 function draw(){
  const area=document.getElementById('chartArea'), w=area.clientWidth,h=area.clientHeight,dpr=window.devicePixelRatio||1;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  panel.classList.toggle('visible',enabled&&options.panel);
  if(!enabled)return;
  if(!app.chart||!app.fullData.length){panel.textContent='HAKS ranges — add your CSV files to BTT/data, then Refresh Data.';return;}
  const poiTf=ConfirmedRanges.poiTimeframe(app.tf.key);
  if(!poiTf){panel.textContent='HAKS: use H1, H4, Daily or Weekly for the POI filter.';return;}
  const poiRows=ensurePoi(app.symbol,poiTf);if(!poiRows)return;
  const clock=app.replay.active?app.replay.clockTime:Math.floor(Date.now()/1000)+BttTime.OFFSET;
  if(!Number.isFinite(clock))return;
  // Only closed bars reach the engine; forming OHLC comes from the chart's partial builder.
  let low=0,high=app.fullData.length;
  while(low<high){const mid=(low+high)>>1;if(candleEndTime(app.fullData[mid],app.tf.key,app.fullData,mid)<=clock)low=mid+1;else high=mid;}
  const count=low,sig=JSON.stringify([options.structure,options.sweeps,options.keepPivots,app.symbol]);
  if(!engine||source!==app.fullData||tf!==app.tf.key||signature!==sig||count<engine.bars.length||poiSource!==poiRows||clock<lastClock){engine=new ConfirmedRanges({...options,tick:10**-pricePrecisionForSymbol(app.symbol)});source=app.fullData;tf=app.tf.key;signature=sig;poiSource=poiRows;poiEngine=new ConfirmedRanges.PoiRejections(options);}
  function advancePoi(until){while(poiEngine.bars.length<poiRows.length){const i=poiEngine.bars.length,end=poiEnd(poiRows,i,poiTf);if(end>until)break;poiEngine.step(poiRows[i],end);}}
  while(engine.bars.length<count){const i=engine.bars.length,b=app.fullData[i],end=candleEndTime(b,app.tf.key,app.fullData,i);advancePoi(end);engine.step(b,{poiTime:poiAt(poiRows,b.time,poiTf),closedTime:end});engine.qualify(poiEngine.records,end);}
  advancePoi(clock);engine.qualify(poiEngine.records,clock);lastClock=clock;
  const partial=app.replay.developingBar;
  const fresh=engine.fresh(partial&&partial.time<=clock?partial:null);
  eligibleCount=Math.min(fresh.length,100);
  const shown=fresh.slice(0,100).map((range,i)=>({range,rank:i+1})).filter(item=>options.selectedRanks==null||options.selectedRanks.includes(item.rank));
  const waiting=engine.ranges.filter(r=>r.qualifiedTime==null).length;
  panel.innerHTML='<div>'+app.tf.key+' → '+poiTf+' · Fresh: '+fresh.length+' | Showing: '+shown.length+' | Waiting HTF: '+waiting+'</div>'+shown.map(({range:r,rank})=>'<div style="font-size:10px;color:'+(r.dir===1?'#008273':'#c12846')+'">R'+rank+' '+(r.dir===1?'BULL':'BEAR')+' · '+r.poiKind+'</div>').join('')+'<small>Closed HTF rejection'+(fresh.length>100?' · Newest 100 shown':'')+(engine.memoryLimited?' · Memory limit':'')+'</small>';
  panel.title=shown.map(({range:r,rank})=>'R'+rank+' '+(r.dir===1?'BULL':'BEAR')+' '+formatPrice(r.lo)+' – '+formatPrice(r.hi)+' · '+poiTf+' '+r.poiKind).join('\n');

  const plotW=Math.max(0,w-65),plotH=Math.max(0,h-28);
  ctx.save();ctx.beginPath();ctx.rect(0,0,plotW,plotH);ctx.clip();
  const x=t=>Coords.timeToX(t), y=p=>activePriceSeries().priceToCoordinate(p);
  function line(t1,t2,p,col,dash=[]){const a=x(t1),b=x(t2),v=y(p);if(a==null||b==null||v==null)return;ctx.strokeStyle=col;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(a,v);ctx.lineTo(b,v);ctx.stroke();ctx.setLineDash([]);}
  const occupied=[];
  if(options.panel)occupied.push({x:Math.max(0,plotW-(panel.offsetWidth||220)),y:0,w:panel.offsetWidth||220,h:(panel.offsetHeight||55)+12});
  for(const bar of app.fullData){if(bar.time>clock)break;const cx=x(bar.time),cy=y(bar.high),cl=y(bar.low);if(cx!=null&&cy!=null&&cl!=null&&cx>=0&&cx<=plotW)occupied.push({x:cx-5,y:cy-4,w:10,h:Math.max(2,cl-cy)+8});}

  function label(t,p,text,col,side=0){
   const a=x(t),b=y(p);if(a==null||b==null||!Number.isFinite(a)||!Number.isFinite(b)||a<0||a>plotW||b<0||b>plotH)return;
   ctx.font='11px system-ui';const width=Math.min(ctx.measureText(text).width+8,plotW),height=17;
   let px=Math.max(0,Math.min(a+12,plotW-width)),py=Math.max(2,Math.min(b+(side<0?-32:side>0?20:-8),plotH-height));
   // Prefer available right-hand whitespace; separate colliding labels.
   const preferred=py;
   let found=false;
   for(let column=0;column<3&&!found;column++){
    const trialX=Math.max(0,Math.min(px-column*(width+8),plotW-width));
    for(let attempt=0;attempt<60;attempt++){
     const shift=attempt===0?0:Math.ceil(attempt/2)*20*(attempt%2?1:-1);
     const trialY=preferred+shift;if(trialY<2||trialY+height>plotH)continue;
     if(!occupied.some(q=>trialX<q.x+q.w+3&&trialX+width+3>q.x&&trialY<q.y+q.h+3&&trialY+height+3>q.y)){px=trialX;py=trialY;found=true;break;}
    }
   }
   occupied.push({x:px,y:py,w:width,h:height});
   ctx.strokeStyle=col;ctx.globalAlpha=.55;ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(Math.max(px,Math.min(a,px+width)),py+height/2);ctx.stroke();ctx.globalAlpha=1;
   ctx.fillStyle=document.body?.classList.contains('theme-dark')?'rgba(17,21,29,.84)':'rgba(255,255,255,.84)';ctx.fillRect(px,py,width,height);
   ctx.fillStyle=col;ctx.fillText(text,px+4,py+12,width-8);
  }

  // Bound the drawing to available candles, not wall-clock whitespace.
  const lastClosed=count>0?app.fullData[count-1]:null;
  const endBar=partial&&partial.time<=clock?partial:lastClosed;
  const endTime=endBar?endBar.time:clock;
  shown.forEach(({range:r,rank:rangeNumber})=>{
   const col=r.dir===1?'#008273':'#c12846',rank='R'+rangeNumber;
   const highTime=r.dir===1?r.extremeTime:r.originTime;
   const lowTime=r.dir===1?r.originTime:r.extremeTime;
   // The fill starts once BOTH boundary candles exist. Each horizontal
   // boundary starts independently at its actual extreme candle.
   const boxStart=r.qualifiedTime;
   const a=x(boxStart),b=x(endTime),top=y(r.hi),bottom=y(r.lo);
   if([a,b,top,bottom].some(v=>v==null||!Number.isFinite(v))||b<a)return;
   ctx.fillStyle=r.dir===1?'rgba(0,130,115,.05)':'rgba(193,40,70,.05)';ctx.fillRect(a,top,b-a,bottom-top);
   ctx.strokeStyle=col;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(a,top);ctx.lineTo(a,bottom);ctx.moveTo(b,top);ctx.lineTo(b,bottom);ctx.stroke();
   // Dots identify the pre-confirmation segment, never an earlier origin
   // belonging to the OTHER boundary. No backward ray is drawn.
   line(highTime,r.confirmedTime,r.hi,col,[2,4]);line(lowTime,r.confirmedTime,r.lo,col,[2,4]);
   line(r.qualifiedTime,endTime,r.hi,col);line(r.qualifiedTime,endTime,r.lo,col);
   label(endTime,r.hi,rank+' '+(r.dir===1?'BULL':'BEAR')+' HIGH '+formatPrice(r.hi),col);label(endTime,r.lo,rank+' LOW '+formatPrice(r.lo),col);
   if(options.evidence){line(r.referenceTime,r.originTime,r.sweepLevel,'#c47700',[6,4]);label(r.originTime,r.origin,rank+' '+r.sweepKind+' sweep','#a65e00',r.dir===1?1:-1);line(r.outwardTime,r.breakTime,r.outward,'#8455af',[6,4]);label(r.breakTime,r.outward,'Outward break','#8455af',r.dir===1?-1:1);line(r.triggerTime,r.confirmedTime,r.trigger,col,[6,4]);label(r.confirmedTime,r.confirmPrice,rank+' CONFIRMED',col,r.dir===1?-1:1);}
  });ctx.restore();
 }
 function state(){return {enabled,...options,selectedRanks:options.selectedRanks==null?null:[...options.selectedRanks]};}
 function configure(values){
  if(Object.prototype.hasOwnProperty.call(values,'selectedRanks'))options.selectedRanks=normalizeRanks(values.selectedRanks);
  if(typeof values.enabled==='boolean')enabled=values.enabled;
  if(['close','wick'].includes(values.structure))options.structure=values.structure;
  if(['both','wick','close'].includes(values.sweeps))options.sweeps=values.sweeps;
  if(Number.isFinite(values.keepPivots))options.keepPivots=Math.max(20,Math.min(200,values.keepPivots));
  for(const key of ['evidence','panel'])if(typeof values[key]==='boolean')options[key]=values[key];
  localStorage.setItem('haks_ranges_on',String(enabled));localStorage.setItem('haks_ranges_options',JSON.stringify(options));
  for(const [id,key]of [['hrStructure','structure'],['hrSweeps','sweeps'],['hrMemory','keepPivots'],['hrEvidence','evidence'],['hrPanel','panel']]){
   const input=document.getElementById(id);if(input.type==='checkbox')input.checked=options[key];else input.value=options[key];
  }
  updateButton();draw();
 }
 updateButton();return {draw,state,configure,mountSelector};
})();
