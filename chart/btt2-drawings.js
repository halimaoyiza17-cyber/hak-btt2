/* BTT 2 drawing gestures and history. Loaded after legacy definitions, before boot. */
(function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const histories = new Map();
  const templateFields=['extendLeft','extendRight','timeframes','fibLevels','fibReverse','endMarker','showStats','showPriceLabels'];
  let transaction = null, restoring = false, currentPointer = null;
  let magnet = localStorage.getItem('btt2_magnet') || 'off';
  if (!['off','weak','strong'].includes(magnet)) magnet = 'off';
  const original = {
    save: Store.save, load: Store.load, select: Store.select, deselect: Store.deselect,
    add: Store.add, remove: Store.remove, clear: Store.clear,
    down: Interaction.pointerDown, move: Interaction.pointerMove, up: Interaction.pointerUp,
    place: Interaction._place, renderShape: Renderer.drawShape,
    body: HitTest.body, handles: HitTest.handles, setTool: Interaction.setTool
  };

  function key() { return Store._key(); }
  function snapshot() {
    return { key:key(), items:clone(Store.items).map(s => ({...s,selected:false})), selectedId:Store.selectedId };
  }
  function equal(a,b) { return a.key === b.key && JSON.stringify(a.items) === JSON.stringify(b.items); }
  function history() {
    const k=key();
    if (!histories.has(k)) histories.set(k,{undo:[],redo:[],baseline:snapshot()});
    return histories.get(k);
  }
  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name,{detail})); }
  function notify() {
    const h=history();
    emit('btt2-history',{canUndo:!!h.undo.length,canRedo:!!h.redo.length,undoLabel:h.undo.at(-1)?.label||'',redoLabel:h.redo.at(-1)?.label||'',magnet});
    emit('btt2-selection',{id:Store.selectedId,shape:Store.selected()||null});
  }
  function repaint() { ObjectTree?.render?.(); Renderer.render(); notify(); }
  function persist() {
    try {
      const clean={};
      for(const [symbol,items] of Object.entries(Store.bySymbol))clean[symbol]=items.map(s=>({...s,selected:false}));
      localStorage.setItem(Store.KEY,JSON.stringify({bySymbol:clean,nextId:Store.nextId}));
      emit('btt2-save',{ok:true,message:'Drawings saved'});return true;
    }catch(error){emit('btt2-save',{ok:false,message:'Drawings could not be saved. Browser storage may be full; keep this tab open and export your work.',error:String(error)});return false;}
  }
  function restore(snap) {
    restoring=true;
    try {
      Store.bySymbol[snap.key]=clone(snap.items);
      if(snap.key===key()){
        Store.selectedId=snap.selectedId;
        Store.items.forEach(s=>{s.selected=s.id===Store.selectedId;});
        if (!Store.items.some(s=>s.id===Store.selectedId)) Store.selectedId=null;
      }
      ObjectTree?.clearSelection?.();
      persist();
    } finally { restoring=false; }
  }
  function record(before,after,label) {
    const h=history();
    if (!equal(before,after)) {
      h.undo.push({before,after,label:label||'Edit drawing'});
      if(h.undo.length>100)h.undo.shift();
      h.redo.length=0;
    }
    h.baseline=after;
  }
  function begin(label) {
    history();
    if(transaction){transaction.depth++;return;}
    transaction={label:label||'Edit drawing',before:snapshot(),depth:1};
  }
  function commit() {
    if(!transaction)return false;
    if(--transaction.depth>0)return false;
    const tx=transaction;transaction=null;
    if(tx.before.key!==key())return false;
    const after=snapshot();record(tx.before,after,tx.label);persist();notify();
    return !equal(tx.before,after);
  }
  function cancel() {
    if(transaction){const tx=transaction;transaction=null;restore(tx.before);const h=histories.get(tx.before.key);if(h)h.baseline=tx.before;}
    Interaction.drag=null;Interaction.draft=null;Interaction.mode=Store.selectedId==null?'idle':'selected';
    Interaction._pan(true);Renderer.render();notify();
  }
  function mutate(label,fn) {
    begin(label);
    try {const result=fn();commit();repaint();return result;}
    catch(error){cancel();throw error;}
  }
  function undo() {
    if(transaction)cancel();
    const h=history(),item=h.undo.pop();if(!item)return false;
    h.redo.push(item);restore(item.before);h.baseline=snapshot();repaint();return true;
  }
  function redo() {
    if(transaction)cancel();
    const h=history(),item=h.redo.pop();if(!item)return false;
    h.undo.push(item);restore(item.after);h.baseline=snapshot();repaint();return true;
  }
  Store.save=function(){
    if(!restoring&&!transaction){const h=history(),after=snapshot();record(h.baseline,after,'Edit drawing');}
    persist();if(!transaction&&!restoring)notify();
  };
  Store.load=function(){original.load.call(this);histories.clear();transaction=null;history();notify();};
  for(const name of ['add','remove','clear'])Store[name]=function(...args){
    if(restoring)return original[name].apply(this,args);
    return mutate(name==='add'?'Create drawing':name==='remove'?'Delete drawing':'Remove drawings',()=>{
      const result=original[name].apply(this,args);
      if(name==='add'){
        const template=TemplateStore.activeFor(result.type);
        for(const field of templateFields)if(template?.[field]!==undefined&&args[0][field]===undefined)result[field]=clone(template[field]);
      }
      return result;
    });
  };
  Store.select=function(id){original.select.call(this,id);notify();};
  Store.deselect=function(){original.deselect.call(this);notify();};
  const onSymbol=Store.onSymbolChange;
  Store.onSymbolChange=function(){if(transaction)cancel();onSymbol.call(this);history();notify();};

  /* Time on the drawing model remains UTC seconds. Gestures translate in logical
     bar coordinates so Friday->Monday does not stretch a drawing on the screen. */
  let cachedBars=null,cachedBase=null,cachedFuture=null,cachedSignature='';
  function bars() {
    const base=app.renderedBars?.length?app.renderedBars:app.fullData||[];
    const future=app.futureAxisBars||[],signature=`${base.length}/${base.at(-1)?.time}/${future.length}/${future.at(-1)?.time}`;
    if(base!==cachedBase||future!==cachedFuture||signature!==cachedSignature){cachedBase=base;cachedFuture=future;cachedSignature=signature;cachedBars=future.length?base.concat(future):base;}
    return cachedBars;
  }
  function timeToLogical(time) {
    const d=bars(),n=d.length;if(!n||!Number.isFinite(time))return null;
    const seconds=Coords.barSecs();
    if(time<=d[0].time)return (time-d[0].time)/seconds;
    if(time>=d[n-1].time)return n-1+(time-d[n-1].time)/seconds;
    let lo=0,hi=n-1;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(d[mid].time<=time)lo=mid;else hi=mid;}
    return lo+(time-d[lo].time)/(d[hi].time-d[lo].time);
  }
  function logicalToTime(logical) {
    const d=bars(),n=d.length;if(!n||!Number.isFinite(logical))return null;
    if(logical<=0)return d[0].time+logical*Coords.barSecs();
    if(logical>=n-1)return d[n-1].time+(logical-n+1)*Coords.barSecs();
    const i=Math.floor(logical);return d[i].time+(logical-i)*(d[i+1].time-d[i].time);
  }
  function logicalToX(logical) {
    const ts=app.chart?.timeScale();if(!ts||!Number.isFinite(logical))return null;
    const i=Math.floor(logical),x0=ts.logicalToCoordinate(i),x1=ts.logicalToCoordinate(i+1);
    return Number.isFinite(x0)&&Number.isFinite(x1)?x0+(x1-x0)*(logical-i):null;
  }
  function xToLogical(x) {
    const ts=app.chart?.timeScale();if(!ts||!Number.isFinite(x))return null;
    const raw=ts.coordinateToLogical(x);if(!Number.isFinite(raw))return null;
    const center=ts.logicalToCoordinate(raw),next=ts.logicalToCoordinate(raw+1);
    return Number.isFinite(center)&&Number.isFinite(next)&&next!==center?raw+(x-center)/(next-center):raw;
  }
  // A stored hourly (or minute) anchor belongs to its containing coarse candle.
  // Interpolating23:00 between daily opens painted it beside tomorrow's candle.
  // Projection must not rewrite the timestamp: returning to H1 recovers23:00.
  function projectedLogical(time){
    const logical=timeToLogical(time);
    return Number.isFinite(logical)?Math.floor(logical+1e-9):null;
  }
  Coords.timeToX=time=>logicalToX(projectedLogical(time));
  // Pointer placement uses candle slots, while the continuous helpers remain
  // available for translating existing timestamps through session gaps.
  Coords.xToTime=x=>{const logical=xToLogical(x);return Number.isFinite(logical)?logicalToTime(Math.round(logical)):null;};
  Coords.positionXAtTime=Coords.timeToX;
  Coords.positionTimeAtX=Coords.xToTime;
  Coords.snapTime=time=>logicalToTime(projectedLogical(time));
  function plotRect() {
    const w=canvas.clientWidth||document.getElementById('chartArea').clientWidth;
    const h=canvas.clientHeight||document.getElementById('chartArea').clientHeight;
    let right=w,bottom=h;
    try {const width=app.chart.timeScale().width();if(Number.isFinite(width)&&width>0)right=Math.min(w,width);}catch(_){}
    try {const height=app.chart.timeScale().height();if(Number.isFinite(height)&&height>=0)bottom=Math.max(1,h-height);}catch(_){}
    if(right===w)try{right=w-app.chart.priceScale('right').width();}catch(_){}
    return {left:0,top:0,right,bottom,width:right,height:bottom};
  }
  function inside(x,y) {const r=plotRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}
  function constrained(x,y) {
    if(!currentPointer?.shiftKey)return {x,y};
    let anchor=null;
    if(Interaction.draft?.type==='trend')anchor=Interaction.draft.points[0];
    else if(Interaction.drag?.kind==='handle'){
      const s=Store.get(Interaction.drag.id);
      if(s?.type==='trend')anchor=s.points[Interaction.drag.handle==='p0'?1:0];
    }
    if(!anchor)return {x,y};
    const p=Coords.pointToScreen(anchor);if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return{x,y};
    const dx=x-p.x,dy=y-p.y,length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;
    return{x:p.x+Math.cos(angle)*length,y:p.y+Math.sin(angle)*length};
  }
  function magnetPoint(x,y,pt) {
    if(magnet==='off'||Interaction.drag?.kind==='body')return pt;
    const drawing=Interaction.tool!=='cursor'||Interaction.drag?.kind==='handle';if(!drawing)return pt;
    const logical=xToLogical(x),i=Math.round(logical),d=app.renderedBars||[];
    const bar=d[i];if(!bar)return pt;
    let best=null;
    for(const price of [bar.open,bar.high,bar.low,bar.close]){
      const yy=Coords.priceToY(price);if(!Number.isFinite(yy))continue;
      const distance=Math.hypot(logicalToX(i)-x,yy-y);
      if(!best||distance<best.distance)best={time:bar.time,price,distance};
    }
    if(best&&(magnet==='strong'||best.distance<=12))return {time:best.time,price:best.price};
    return pt;
  }
  Coords.screenToPoint=function(sx,sy){
    if(!Number.isFinite(sx)||!Number.isFinite(sy))return{time:null,price:null};
    const p=constrained(sx,sy);
    return magnetPoint(p.x,p.y,{time:Coords.xToTime(p.x),price:Coords.yToPrice(p.y)});
  };
  function setMagnet(value){magnet=['off','weak','strong'].includes(value)?value:'off';localStorage.setItem('btt2_magnet',magnet);notify();return magnet;}
  function toggleMagnet(){return setMagnet(magnet==='off'?'weak':magnet==='weak'?'strong':'off');}
  function visible(s){return s?.visible!==false&&(!Array.isArray(s.timeframes)||s.timeframes.includes(app.tf?.key));}
  const captureTemplate=TemplateStore.capture;
  TemplateStore.capture=function(s){
    const result=captureTemplate.call(this,s);
    for(const field of templateFields)if(s[field]!==undefined)result[field]=clone(s[field]);
    return result;
  };

  /* Selected handles have priority. Unselected objects are hit in visual order;
     their invisible handles never intercept the body of a newer drawing. */
  HitTest.at=function(x,y){
    if(!inside(x,y))return null;
    const selected=Store.selected(),radius=matchMedia('(pointer:coarse)').matches?13:8;
    if(selected&&visible(selected)&&!selected.locked){
      for(const h of this.handles(selected))if(Number.isFinite(h.x)&&Number.isFinite(h.y)&&Math.hypot(x-h.x,y-h.y)<=radius)return{shape:selected,kind:'handle',handle:h.name};
    }
    for(let i=Store.items.length-1;i>=0;i--){const s=Store.items[i];if(visible(s)&&this.body(s,x,y,radius))return{shape:s,kind:'body'};}
    return null;
  };
  function trendSegment(s) {
    const a=Coords.pointToScreen(s.points?.[0]),b=Coords.pointToScreen(s.points?.[1]);
    if([a.x,a.y,b.x,b.y].some(v=>!Number.isFinite(v)))return null;
    if(!s.extendLeft&&!s.extendRight)return{a,b};
    const r=plotRect(),dx=b.x-a.x,dy=b.y-a.y;
    if(Math.hypot(dx,dy)<.01)return{a,b};
    const reverse=b.x<a.x;
    let low=(reverse?s.extendRight:s.extendLeft)?-Infinity:0,high=(reverse?s.extendLeft:s.extendRight)?Infinity:1;
    for(const [p,q] of [[-dx,a.x-r.left],[dx,r.right-a.x],[-dy,a.y-r.top],[dy,r.bottom-a.y]]){
      if(p===0){if(q<0)return null;continue;}
      const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);
    }
    if(low>high||!Number.isFinite(low)||!Number.isFinite(high))return null;
    return{a:{x:a.x+dx*low,y:a.y+dy*low},b:{x:a.x+dx*high,y:a.y+dy*high}};
  }
  function textBounds(s){
    const p=Coords.pointToScreen(s.points[0]);if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return null;
    const size=Number(s.style?.fontSize)||12,lines=String(s.text||'Text').split('\n');
    ctx.save();ctx.font=`${size}px -apple-system,Segoe UI,Arial,sans-serif`;
    const width=Math.max(...lines.map(line=>ctx.measureText(line).width))+8;ctx.restore();
    return{left:p.x,right:p.x+width,top:p.y-size-4,bottom:p.y+(lines.length-1)*(size+5)+4};
  }
  HitTest.body=function(s,x,y,radius){
    if(!visible(s))return false;
    if(s.type==='trend'){const l=trendSegment(s);return!!l&&distSeg(x,y,l.a.x,l.a.y,l.b.x,l.b.y)<=radius;}
    if(s.type==='text'){const b=textBounds(s);return!!b&&x>=b.left-radius&&x<=b.right+radius&&y>=b.top-radius&&y<=b.bottom+radius;}
    if(s.type==='fib'){
      const a=Coords.pointToScreen(s.points[0]),b=Coords.pointToScreen(s.points[1]);
      if(!Number.isFinite(a.x)||!Number.isFinite(b.x)||x<Math.min(a.x,b.x)-radius||x>Math.max(a.x,b.x)+radius)return false;
      return fibLevels(s).some(level=>Math.abs(y-Coords.priceToY(fibPrice(s,level)))<=radius);
    }
    return original.body.call(this,s,x,y,radius);
  };
  function fibLevels(s){const levels=Array.isArray(s.fibLevels)?s.fibLevels:[0,.5,1];return levels.filter(Number.isFinite).slice(0,50);}
  function fibPrice(s,level){return s.points[0].price+(s.points[1].price-s.points[0].price)*(s.fibReverse?1-level:level);}
  function drawFib(s){
    const a=Coords.pointToScreen(s.points[0]),b=Coords.pointToScreen(s.points[1]);
    if([a.x,a.y,b.x,b.y].some(v=>!Number.isFinite(v)))return;
    const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),col=s.style?.color||'#2962ff';
    const opacity=Number.isFinite(s.style?.fillOpacity)?Math.max(0,Math.min(1,s.style.fillOpacity)):.12;
    const levels=fibLevels(s).map(level=>({level,price:fibPrice(s,level)})).map(item=>({...item,y:Coords.priceToY(item.price)})).filter(item=>Number.isFinite(item.y));
    const bands=[...levels].sort((one,two)=>one.y-two.y);
    // One fill preference applies to every configured band. Alternating opacity
    // keeps neighboring levels legible without inventing per-level settings.
    if(opacity>0)for(let i=1;i<bands.length;i++){
      ctx.fillStyle=hexRgba(s.style?.fillColor||col,opacity*(i%2?1:.55));
      ctx.fillRect(left,bands[i-1].y,right-left,bands[i].y-bands[i-1].y);
    }
    ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=s.style?.width||2;ctx.font='11px -apple-system,Segoe UI,Arial,sans-serif';
    ctx.setLineDash(s.lineStyle==='dashed'?[8,5]:s.lineStyle==='dotted'?[2,4]:[]);
    for(const {level,price,y} of levels){
      ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillText(`${Number((level*100).toFixed(3))}%  ${formatPrice(price)}`,right+5,y-3);
    }
    if(s.text)Renderer.drawShapeText(s);
  }
  const oldBounds=Renderer.shapeBounds;
  Renderer.shapeBounds=function(s){return s.type==='text'?textBounds(s):oldBounds.call(this,s);};
  Renderer.drawShape=function(s){
    if(!visible(s))return;
    const r=plotRect();ctx.save();ctx.beginPath();ctx.rect(r.left,r.top,r.width,r.height);ctx.clip();
    try{
      if(s.type==='trend'){
        const l=trendSegment(s);if(!l)return;
        ctx.strokeStyle=s.style?.color||'#2962ff';ctx.lineWidth=s.style?.width||2;
        ctx.setLineDash(s.lineStyle==='dashed'?[8,5]:s.lineStyle==='dotted'?[2,4]:[]);
        ctx.beginPath();ctx.moveTo(l.a.x,l.a.y);ctx.lineTo(l.b.x,l.b.y);ctx.stroke();
        if(s.text)this.drawShapeText(s);
      }else if(s.type==='fib')drawFib(s);
      else original.renderShape.call(this,s);
    }finally{ctx.restore();}
    // Axis labels are painted outside the clipped drawing pane.
    if((s.type==='hline'||s.type==='hray')&&s.points?.[0])this.priceTag(Coords.priceToY(s.points[0].price),s.points[0].price,s.style?.color||'#2962ff');
    if(s.type==='vline'&&s.points?.[0])this.timeTag(Coords.timeToX(s.points[0].time),s.points[0].time,s.style?.color||'#2962ff');
    if(['long','short'].includes(s.type)&&s.position?.showPriceLabels!==false&&(s.selected||s.position?.showAlways)){
      for(const [value,color] of [[s.tp,s.position?.targetColor||'#089981'],[s.entry,'#434651'],[s.sl,s.position?.stopColor||'#f23645']]){
        const y=Coords.priceToY(value);if(Number.isFinite(y)&&y>=r.top&&y<=r.bottom)this.priceTag(y,value,color);
      }
    }
  };
  const drawDraft=Renderer.drawDraft,drawHandles=Renderer.drawHandles;
  Renderer.drawDraft=function(s){const r=plotRect();ctx.save();ctx.beginPath();ctx.rect(0,0,r.width,r.height);ctx.clip();try{drawDraft.call(this,s);}finally{ctx.restore();}};
  Renderer.drawHandles=function(s){if(s.locked||!visible(s))return;const r=plotRect();ctx.save();ctx.beginPath();ctx.rect(0,0,r.width,r.height);ctx.clip();try{drawHandles.call(this,s);}finally{ctx.restore();}};

  Interaction._dragBody=function(s,snap,_dt,dp){
    const drag=this.drag;if(!drag)return;
    let delta=xToLogical(currentPointer?this._pos(currentPointer).x:drag.startX)-drag.startLogical;
    if(!Number.isFinite(delta))delta=0;
    delta=Math.round(delta);
    if(currentPointer?.shiftKey){const p=this._pos(currentPointer);if(Math.abs(p.x-drag.startX)>=Math.abs(p.y-drag.startY))dp=0;else delta=0;}
    const shifted=t=>logicalToTime(timeToLogical(t)+delta);
    if(['trend','rect','fib'].includes(s.type))s.points=snap.points.map(p=>({time:shifted(p.time),price:p.price+dp}));
    else if(s.type==='hline')s.points[0].price=snap.points[0].price+dp;
    else if(s.type==='vline')s.points[0]={time:Coords.snapTime(shifted(snap.points[0].time)),price:snap.points[0].price};
    else if(['hray','text'].includes(s.type))s.points[0]={time:shifted(snap.points[0].time),price:snap.points[0].price+dp};
    else if(['long','short'].includes(s.type)){
      s.points[0].time=shifted(snap.points[0].time);s.endTime=shifted(snap.endTime);
      s.entry=snap.entry+dp;s.tp=snap.tp+dp;s.sl=snap.sl+dp;s.points[0].price=s.entry;
      s.position={...(s.position||{}),startBarTime:s.points[0].time};
      window.BTT2Positions?.normalize?.(s);
    }
  };
  Interaction.pointerDown=function(e){
    if(e.pointerType!=='touch'&&e.button!==undefined&&e.button!==0)return;
    if(e.isPrimary===false)return;
    if(e.target?.closest?.('#settingsPopup,#objectTree,#replayPickerControls,#templateChip,#styleChip,.btt2-ui'))return;
    const p=this._pos(e);if(!inside(p.x,p.y))return;
    currentPointer=e;
    try{
      const canHit=this.tool==='cursor'||this.mode==='selected'||this.mode==='idle';
      if(canHit&&HitTest.at(p.x,p.y))begin('Move drawing');
      const tree=document.getElementById('objectTree'),keepTree=tree?.closest?.('#rightDock')&&tree.classList.contains('visible');
      original.down.call(this,e);
      if(keepTree){tree.classList.add('visible');document.getElementById('btnObjects')?.classList.add('active');}
      if(this.drag){this.drag.startLogical=xToLogical(p.x);this.drag.pointerId=e.pointerId;if(transaction)transaction.label=this.drag.kind==='handle'?'Resize drawing':'Move drawing';}
      if(this.draft?.dragging)this.draft.pointerId=e.pointerId;
    }finally{currentPointer=null;}
  };
  Interaction.pointerMove=function(e){
    if(e.target?.closest?.('.btt2-ui'))return;
    if(this.drag?.pointerId!==undefined&&e.pointerId!==this.drag.pointerId)return;
    if(this.draft?.dragging&&this.draft.pointerId!==undefined&&e.pointerId!==this.draft.pointerId)return;
    currentPointer=e;
    try{
      if(this.drag&&!this.drag.moved){
        const p=this._pos(e),threshold=e.pointerType==='touch'?5:3;
        if(Math.hypot(p.x-this.drag.startX,p.y-this.drag.startY)<threshold){e.preventDefault();e.stopPropagation();return;}
        this.drag.moved=true;
      }
      original.move.call(this,e);
      if(!this.drag&&!this.draft){
        const p=this._pos(e),r=plotRect(),hit=HitTest.at(p.x,p.y);
        document.getElementById('chartArea').style.cursor=p.x>r.right?'ns-resize':p.y>r.bottom?'ew-resize':this.tool!=='cursor'?'crosshair':hit?.shape.locked?'default':hit?.kind==='handle'?'crosshair':hit?'move':'';
      }
    }finally{currentPointer=null;}
  };
  Interaction.pointerUp=function(e){
    if(e.pointerType!=='touch'&&e.button!==undefined&&e.button!==0)return;
    if(this.drag?.pointerId!==undefined&&e.pointerId!==this.drag.pointerId)return;
    if(this.draft?.dragging&&this.draft.pointerId!==undefined&&e.pointerId!==this.draft.pointerId)return;
    if(e.target?.closest?.('#settingsPopup,#objectTree,#replayPickerControls,#templateChip,#styleChip,.btt2-ui'))return;
    if(ReplayPicker.active&&ReplayPicker.touchId===e.pointerId){ReplayPicker.touchId=null;e.preventDefault();e.stopPropagation();return;}
    const drag=this.drag;
    if(drag){
      this.drag=null;this.mode='selected';this._pan(true);
      if(transaction)commit();else Store.save();
      Renderer.render();
      // Selection opens only the compact toolbar. Observation boxes keep their
      // established triple-tap hide action; detailed properties belong to UI.
      if(!drag.moved){const shape=Store.get(drag.id);if(shape)Observations?.tap?.(shape);}
    }else if(this.tool==='cursor'&&!this.draft){
      const p=this._pos(e),which=WeekMarkers.hit(p.x);if(which)WeekMarkers.registerTap(which);
    }
    if(this.draft?.type==='rect'&&this.draft.dragging){
      const a=Coords.pointToScreen(this.draft.points[0]),b=Coords.pointToScreen(this.draft.points[1]);
      if(Math.abs(a.x-b.x)>=3&&Math.abs(a.y-b.y)>=3){
        if(this.tool==='observation')Observations.create(this.draft.points);
        else Store.add({type:'rect',points:clone(this.draft.points)});
      }
      this.draft=null;this.setTool('cursor');
    }
    notify();
  };
  Interaction._place=function(pt,x,y,e){
    if(this.tool==='long'||this.tool==='short'){
      const r=plotRect(),px=Coords.timeToX(pt.time);
      const startX=Number.isFinite(px)?px:x;
      if(!inside(startX,y)||!Number.isFinite(pt.price))return;
      const width=Math.min(160,r.width*.28,r.right-startX);
      if(width<8){showHint('Place the position slightly farther from the price scale');return;}
      const tick=10**-pricePrecisionForSymbol(app.symbol);
      const unit=Math.abs((Coords.yToPrice(y+1)??pt.price)-(Coords.yToPrice(y)??pt.price))||tick;
      const risk=Math.max(tick,unit*Math.min(38,r.height*.1)),reward=Math.max(tick,unit*Math.min(65,r.height*.17)),dir=this.tool==='long'?1:-1;
      const startTime=Coords.positionTimeAtX(startX),endTime=Coords.positionTimeAtX(startX+width);
      if(!Number.isFinite(startTime)||!Number.isFinite(endTime))return;
      Store.add({type:this.tool,points:[{time:startTime,price:pt.price}],entry:pt.price,sl:pt.price-dir*risk,tp:pt.price+dir*reward,endTime,position:{startBarTime:startTime}});
      this.setTool('cursor');e.preventDefault();e.stopPropagation();return;
    }
    // Reject zero-length second anchors, but keep the draft ready for a valid click.
    if(this.draft&&['trend','fib'].includes(this.draft.type)){
      const a=Coords.pointToScreen(this.draft.points[0]);
      if(Math.hypot(a.x-x,a.y-y)<3){e.preventDefault();e.stopPropagation();return;}
    }
    return original.place.call(this,pt,x,y,e);
  };
  Interaction.setTool=function(tool){if(transaction)cancel();original.setTool.call(this,tool);notify();};
  function editable(target){return !!target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]');}
  window.addEventListener('keydown',e=>{
    if(editable(e.target)){
      // Keep native text editing, but do not let legacy global Backspace/Delete
      // remove the selected chart object while typing in a textarea/editor.
      if(e.key==='Delete'||e.key==='Backspace')e.stopImmediatePropagation();
      return;
    }
    if(e.key==='Escape'&&document.querySelector('.dialog-shade'))return;
    if(e.key==='Escape')emit('btt2-cancel-tool',{reason:'escape'});
    if(e.key==='Escape'&&(transaction||Interaction.drag||Interaction.draft||Interaction.tool!=='cursor')){cancel();Interaction.setTool('cursor');e.preventDefault();e.stopImmediatePropagation();return;}
    if((e.ctrlKey||e.metaKey)&&!e.altKey){
      const k=e.key.toLowerCase();
      if(k==='z'||k==='y'){(k==='y'||e.shiftKey?redo:undo)();e.preventDefault();e.stopImmediatePropagation();}
    }
  },true);
  document.getElementById('chartArea').addEventListener('pointercancel',()=>cancel(),true);
  window.addEventListener('blur',()=>{if(Interaction.drag||Interaction.draft)cancel();});
  const guide=CursorUI.guide;
  if(typeof guide==='function')CursorUI.guide=function(e){
    const p=Interaction._pos(e);if(!inside(p.x,p.y)){app.chart?.clearCrosshairPosition?.();return;}
    return guide.call(this,e);
  };

  window.BTT2Drawing={begin,commit,cancel,execute:mutate,mutate,undo,redo,notify,plotRect,visible,
    setTool:tool=>Interaction.setTool(tool),setMagnet,toggleMagnet,
    state:()=>({magnet,canUndo:!!history().undo.length,canRedo:!!history().redo.length,selectedId:Store.selectedId}),
    coordinates:{timeToLogical,logicalToTime,xToLogical,logicalToX,projectedLogical},
    resetHistory:()=>{histories.clear();transaction=null;history();notify();}
  };
  history();
})();
