/* Independent observation workspaces. Price data and the range engine are shared;
 * drawings, replay clocks and saved views are isolated by observation ID. */
const Observations = {
  key:'btt2_observations_v1', items:[], busy:false, collapsed:false,
  clone(v){return JSON.parse(JSON.stringify(v));},
  load(){try{this.items=JSON.parse(localStorage.getItem(this.key)||'[]');}catch(e){showHint('Could not read saved observations');}},
  save(){try{localStorage.setItem(this.key,JSON.stringify(this.items));return true;}catch(e){showHint('Observation storage is full. Please free browser storage before saving more.');return false;}},
  current(){return this.items.find(o=>'obs:'+o.id===app.wlSection);},
  view(){let range=null;try{range=app.chart.timeScale().getVisibleRange();}catch(e){}return {tf:app.tf.key,range,chartType:app.chartType};},
  capture(){if(this.busy||app.switching||app._restoringSession)return;const o=this.current();if(!o)return;Object.assign(o,this.view());this.save();Session.save();},
  create(points){
    if(!points.every(p=>Number.isFinite(p.time)&&Number.isFinite(p.price))||points[0].time===points[1].time||points[0].price===points[1].price){showHint('Draw a larger observation rectangle');return;}
    const id=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8), ns='obs:'+id;
    const n=1+this.items.filter(o=>o.symbol===app.symbol).reduce((m,o)=>Math.max(m,o.number||0),0);
    const box={id:Store.nextId++,type:'rect',points:this.clone(points),style:{...DEFAULT_STYLE},visible:true,selected:false,text:'Observation '+n,observationId:id};
    const o={id,symbol:app.symbol,number:n,name:app.symbol+' · '+n,boxId:box.id,created:displayBarTime(points[0].time),...this.view()};
    this.items.push(o);if(!this.save()){this.items.pop();return;}
    Store.bySymbol[ns+'|'+app.symbol]=this.clone(Store.items).map(s=>({...s,id:Store.nextId++,selected:false,symbol:ns+'|'+app.symbol,observationId:undefined}));
    Store.bySymbol[ns+'|'+app.symbol].push(box);
    persistReplayForSymbol(app.symbol,app.wlSection);
    app.replayBySection[ns]={[app.symbol]:this.clone(app.replayBySection[replayNamespace(app.wlSection)][app.symbol])};
    Store.save();Session.save();buildWatchlist();showHint('Saved '+o.name+' in Observations');
  },
  async open(o){
    if(this.busy)return;this.capture();this.busy=true;
    const range=this.clone(o.range),tf=o.tf;
    try{await setSymbolTf(o.symbol,tf,{section:'obs:'+o.id});if(o.chartType!==app.chartType)applyChartType(o.chartType);
      if(range?.from!=null)app.chart.timeScale().setVisibleRange(range);
    }finally{this.busy=false;this.capture();Session.save();buildWatchlist();Renderer.render();}
  },
  box(o){return (Store.bySymbol['obs:'+o.id+'|'+o.symbol]||[]).find(s=>s.id===o.boxId);},
  toggle(o){const s=this.box(o);if(!s)return;s.visible=!s.visible;if(!s.visible)s.selected=false;Store.save();this.renderRows();Renderer.render();ObjectTree.render();},
  tap(shape){const o=this.current();if(!o||shape.id!==o.boxId)return false;const now=Date.now();this.taps=(this.tapId===shape.id&&now-this.tapAt<1500)?this.taps+1:1;this.tapId=shape.id;this.tapAt=now;if(this.taps===3){this.taps=0;this.toggle(o);}return true;},
  mount(parent){const h=document.createElement('h4');h.textContent=(this.collapsed?'▶':'▼')+' Observations ('+this.items.length+')';h.style.cursor='pointer';h.onclick=()=>{this.collapsed=!this.collapsed;buildWatchlist();};parent.append(h);const body=document.createElement('div');body.id='observationRows';body.hidden=this.collapsed;parent.append(body);this.renderRows();},
  renderRows(){const body=document.getElementById('observationRows');if(!body)return;body.replaceChildren();
    if(!this.items.length){const empty=document.createElement('div');empty.className='wl-empty';empty.textContent='Draw an observation rectangle ⊡ to save a setup.';body.append(empty);}
    for(const o of ListOrder.sort('observations',this.items,o=>o.id)){const row=document.createElement('div');row.className='obs-row'+(this.current()?.id===o.id?' active':'');
      const star=document.createElement('button');star.className='obs-star '+(o.star||'');star.textContent=o.star?'★':'☆';star.title='Star (blue → red → black/no setup → off)';star.setAttribute('aria-label','Star '+o.name+(o.star?' · '+o.star:''));star.onclick=e=>{e.stopPropagation();o.star=!o.star?'blue':o.star==='blue'?'red':o.star==='red'?'black':null;this.save();this.renderRows();};
      const name=document.createElement('button');name.className='obs-name';name.textContent=o.name;name.title='Open '+o.name;name.onclick=()=>this.open(o);
      const eye=document.createElement('button');const visible=this.box(o)?.visible!==false;eye.className='obs-eye';eye.textContent=visible?'◉':'⊘';eye.title=visible?'Hide observation box':'Show observation box';eye.setAttribute('aria-label',eye.title+' '+o.name);eye.onclick=()=>this.toggle(o);
      const menu=document.createElement('button');menu.textContent='⋯';menu.title='Observation options '+o.name;
      const detail=document.createElement('small');detail.textContent=o.tf+' · '+o.created;
      const actions=document.createElement('div');actions.className='obs-actions';actions.hidden=true;
      const rename=document.createElement('button');rename.textContent='Rename';rename.onclick=()=>{const input=document.createElement('input');input.value=o.name;input.maxLength=80;const done=document.createElement('button');done.textContent='Save name';done.onclick=()=>{o.name=input.value.trim()||o.name;this.save();buildWatchlist();};actions.replaceChildren(input,done);input.focus();};
      const del=document.createElement('button');del.textContent='Delete observation';del.onclick=()=>this.remove(o);
      actions.append(rename,del);menu.onclick=()=>{actions.hidden=!actions.hidden;};row.append(star,name,eye,menu,detail,actions);ListOrder.bind(row,'observations',o.id);body.append(row);
    }
  },
  async remove(o){this.capture();if(this.current()?.id===o.id)await setSymbolTf(o.symbol,o.tf,{section:'pairs'});
    const index=this.items.indexOf(o);this.items.splice(index,1);this.save();buildWatchlist();
    const toast=document.createElement('div');toast.className='obs-undo';toast.textContent='Observation deleted. ';const undo=document.createElement('button');undo.textContent='Undo';undo.onclick=()=>{this.items.splice(Math.min(index,this.items.length),0,o);this.save();buildWatchlist();toast.remove();};toast.append(undo);document.body.append(toast);setTimeout(()=>toast.remove(),15000);
    // Keep its isolated drawing/clock slot for Undo; never touch market data.
  }
};
Observations.load();
window.addEventListener('pagehide',()=>{Observations.capture();Store.save();Session.save();});
setInterval(()=>Observations.capture(),1000);

