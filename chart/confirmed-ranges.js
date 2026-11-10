// Mozilla Public License 2.0. JavaScript port of Confirmed Untouched Ranges v2.0 + closed HTF POI.
// The wick mode intentionally preserves the Pine source's delayed-return behavior.
(function(root){
'use strict';
class ConfirmedRanges {
 constructor(options={}) { this.options={structure:'close',sweeps:'both',keepPivots:100,tick:0.00001,...options}; this.bars=[];this.refs=[];this.candidates=[];this.ranges=[];this.completed=0;this.touched=0;this.memoryLimited=false; }
 step(b, context={}) {
  const i=this.bars.length, o=this.options, body=o.structure==='close';
  const sh=x=>body?x.close:x.high, sl=x=>body?x.close:x.low;
  const prev=this.bars[i-1], left=this.bars[i-2];
  // Rightmost equal pivot wins (strict comparison on the right).
  const pivot=(key,high)=>left && prev && (high ? prev[key]>=left[key]&&prev[key]>b[key] : prev[key]<=left[key]&&prev[key]<b[key]) ? prev[key] : null;
  const wh=pivot('high',true), wl=pivot('low',false), ch=pivot('close',true), cl=pivot('close',false);
  for(const r of this.refs){
   const enabled=r.wick?o.sweeps!=='close':o.sweeps!=='wick';
   const probe=r.wick?(r.dir===-1?b.high:b.low):b.close;
   if(!r.used&&enabled&&(r.dir===-1?probe>r.level:probe<r.level)){
    let c=this.candidates.find(c=>c.dir===r.dir&&c.originBar===i);
    if(c){
     if(r.dir===-1?r.opposite<c.outward:r.opposite>c.outward){c.outward=r.opposite;c.outwardTime=r.oppositeTime;}
     if(r.atBar<c.referenceBar){c.referenceBar=r.atBar;c.referenceTime=r.atTime;c.sweepLevel=r.level;}
     if(c.sweepKind!==(r.wick?'Wick':'Close'))c.sweepKind='Wick/close';
    }else this.candidates.push({dir:r.dir,stage:0,sweepLevel:r.level,referenceBar:r.atBar,referenceTime:r.atTime,sweepKind:r.wick?'Wick':'Close',origin:r.dir===-1?b.high:b.low,originBar:i,originTime:b.time,outward:r.opposite,outwardTime:r.oppositeTime,extreme:r.dir===-1?b.low:b.high,extremeBar:i,extremeTime:b.time,pendingLevel:null,trigger:null,reach:0,structuralExtreme:null,pendingBarrier:null,extremePoiTime:context.poiTime});
    r.used=true;
   }
   if(r.dir===-1?sl(b)<r.opposite:sh(b)>r.opposite){r.opposite=r.dir===-1?sl(b):sh(b);r.oppositeTime=b.time;}
  }
  const events=[];
  for(let j=this.candidates.length-1;j>=0;j--){
   const c=this.candidates[j], bear=c.dir===-1; let remove=false;
   if(bear?b.high>c.origin:b.low<c.origin){
    if(c.stage===2)remove=true;
    else Object.assign(c,{origin:bear?b.high:b.low,originBar:i,originTime:b.time,extreme:bear?b.low:b.high,extremeBar:i,extremeTime:b.time,pendingLevel:null,trigger:null,stage:0,structuralExtreme:null,pendingBarrier:null,extremePoiTime:context.poiTime});
   }
   if(!remove){
    if(c.structuralExtreme==null)c.structuralExtreme=bear?sl(b):sh(b);
    if(c.stage===0&&(bear?b.close<c.sweepLevel:b.close>c.sweepLevel))c.stage=1;
    const ip=bear?(body?ch:wh):(body?cl:wl);
    if(ip!==null&&i-1>c.originBar){c.pendingLevel=ip;c.pendingBar=i-1;c.pendingTime=prev.time;c.pendingBarrier=c.structuralExtreme;}
    if(bear?b.low<c.extreme:b.high>c.extreme){
     c.extreme=bear?b.low:b.high;c.extremeBar=i;c.extremeTime=b.time;c.extremePoiTime=context.poiTime;
     if(c.pendingLevel!==null&&c.pendingBar<i){const valid=bear?b.close<c.pendingBarrier:b.close>c.pendingBarrier;c.trigger=valid?c.pendingLevel:null;c.triggerTime=valid?c.pendingTime:null;}
    }
    if(c.pendingBarrier!=null&&(bear?b.close<c.pendingBarrier:b.close>c.pendingBarrier)&&c.extremeBar>c.pendingBar){c.trigger=c.pendingLevel;c.triggerTime=c.pendingTime;}
    c.structuralExtreme=bear?Math.min(c.structuralExtreme,sl(b)):Math.max(c.structuralExtreme,sh(b));
    if(c.stage===1&&(bear?b.close<c.outward:b.close>c.outward)&&i>c.originBar){
     c.stage=2;c.breakTime=b.time;
     c.reach=Math.max(1,this.refs.filter(r=>(body?!r.wick:r.wick)&&r.dir===-c.dir&&r.atBar>=c.referenceBar&&r.atBar<c.originBar&&(bear?b.close<r.level:b.close>r.level)).length);
    }
    const broken=c.trigger!==null&&(bear?b.close>c.trigger:b.close<c.trigger);
    if(c.stage<2&&broken)remove=true;
    const hi=bear?c.origin:c.extreme,lo=bear?c.extreme:c.origin;
    if(c.stage===2&&broken&&b.time>c.breakTime&&b.close>lo&&b.close<hi){
     if(!this.ranges.some(r=>r.dir===c.dir&&r.originTime===c.originTime&&Math.abs(r.hi-hi)<o.tick&&Math.abs(r.lo-lo)<o.tick)){
      const r={...c,hi,lo,confirmedBar:i,confirmedTime:b.time,confirmPrice:b.close,rejectionTime:c.extremePoiTime,confirmedClose:context.closedTime??b.time,qualifiedTime:null};this.ranges.push(r);this.completed++;events.push(r);
     }remove=true;
    }
   }
   if(remove)this.candidates.splice(j,1);
  }
  const add=(dir,wick,level)=>{
   if(level===null)return;
   const opposite=dir===-1?Math.min(sl(prev),sl(b)):Math.max(sh(prev),sh(b));
   const current=dir===-1?sl(b)<sl(prev):sh(b)>sh(prev);
   this.refs.push({dir,wick,level,atBar:i-1,atTime:prev.time,opposite,oppositeTime:current?b.time:prev.time,used:false});
  };
  add(-1,true,wh);add(1,true,wl);add(-1,false,ch);add(1,false,cl);
  if(this.refs.length>o.keepPivots*4)this.refs.splice(0,this.refs.length-o.keepPivots*4);
  if(this.candidates.length>160){this.candidates.splice(0,this.candidates.length-160);this.memoryLimited=true;}
  const before=this.ranges.length;
  this.ranges=this.ranges.filter(r=>!(i>r.confirmedBar&&(b.high>=r.hi||b.low<=r.lo)));
  this.touched+=before-this.ranges.length;this.bars.push(b);return events;
 }
 qualify(records, clock) {
  const accepted=[];
  this.ranges=this.ranges.filter(r=>{
   if(r.qualifiedTime!=null)return true;
   const p=records.get(r.rejectionTime);
   if(!p||p.closedTime>clock)return true;
   if(!(r.dir===-1?p.bull:p.bear))return false;
   r.qualifiedTime=Math.max(r.confirmedClose,p.closedTime);
   r.poiLevel=r.dir===-1?p.bullLevel:p.bearLevel;
   r.poiKind=r.dir===-1?p.bullKind:p.bearKind;
   r.rejectionClosed=p.closedTime;accepted.push(r);return true;
  });return accepted;
 }
 fresh(partial=null){return this.ranges.filter(r=>r.qualifiedTime!=null&&(!partial||partial.time<=r.confirmedTime||(partial.high<r.hi&&partial.low>r.lo))).slice().reverse();}
 static poiTimeframe(tf){return ['15m','30m','1h'].includes(tf)?'1d':tf==='4h'?'1w':['1d','1w'].includes(tf)?'1mo':null;}

}
// Same level creation, conversion and rejection order as Pine v2.0.
class PoiRejections {
 constructor(options={}){this.keep=options.keepPivots??100;this.levels=[];this.lows=[];this.highs=[];this.bars=[];this.records=new Map();}
 step(b,closedTime){
  const i=this.bars.length,prev=this.bars[i-1],bullish=b.close>b.open,bearish=b.close<b.open;
  const support=prev&&prev.close<prev.open&&bullish,resistance=prev&&prev.close>prev.open&&bearish;
  const e={candleTime:b.time,closedTime,bull:false,bear:false,bullLevel:null,bearLevel:null,bullKind:'',bearKind:''};
  const reject=(bull,price,kind)=>{const side=bull?'bull':'bear';e[side]=true;if(e[side+'Level']==null||(bull?price<e[side+'Level']:price>e[side+'Level'])){e[side+'Level']=price;e[side+'Kind']=kind;}};
  for(const p of this.levels){
   const touch=b.low<=p.price&&b.high>=p.price,up=b.close>p.price&&prev.close<=p.price,down=b.close<p.price&&prev.close>=p.price;
   if(p.role===1&&touch&&b.close>p.price&&prev.close>=p.price)reject(true,p.price,p.kind);
   if(p.role===-1&&touch&&b.close<p.price&&prev.close<=p.price)reject(false,p.price,p.kind);
   if((up||down)&&p.visits>=2){p.kind='QM';p.role=up?1:-1;}
   else if(up&&['Resistance','SBR'].includes(p.kind)){p.kind='RBS';p.role=1;}
   else if(down&&['Support','RBS'].includes(p.kind)){p.kind='SBR';p.role=-1;}
   else if((p.role===1&&b.close<p.price)||(p.role===-1&&b.close>p.price))p.role=0;
   if(touch||up||down)p.visits++;p.touching=touch;
  }
  for(let j=this.lows.length-1;j>=0;j--){const p=this.lows[j],internal=support&&p.created===i-1;if(!internal&&b.low<p.price&&b.close>p.price)reject(true,p.price,'Bullish wick sweep');if(internal||b.close<p.price)this.lows.splice(j,1);}
  for(let j=this.highs.length-1;j>=0;j--){const p=this.highs[j],internal=resistance&&p.created===i-1;if(!internal&&b.high>p.price&&b.close<p.price)reject(false,p.price,'Bearish wick sweep');if(internal||b.close>p.price)this.highs.splice(j,1);}
  const add=(role,kind)=>this.levels.push({price:prev.close,role,kind,visits:0,touching:false});
  if(support)add(1,'Support');if(resistance)add(-1,'Resistance');
  if(prev&&bullish&&prev.close>prev.open)add(1,'Bullish OCL');
  if(prev&&bearish&&prev.close<prev.open)add(-1,'Bearish OCL');
  this.lows.push({price:support?Math.min(prev.low,b.low):b.low,created:i});this.highs.push({price:resistance?Math.max(prev.high,b.high):b.high,created:i});
  if(this.levels.length>this.keep*4)this.levels.splice(0,this.levels.length-this.keep*4);
  if(this.lows.length>this.keep*2)this.lows.splice(0,this.lows.length-this.keep*2);
  if(this.highs.length>this.keep*2)this.highs.splice(0,this.highs.length-this.keep*2);
  this.bars.push(b);this.records.set(b.time,e);if(this.records.size>600)this.records.delete(this.records.keys().next().value);return e;
 }
}
ConfirmedRanges.PoiRejections=PoiRejections;
if(typeof module!=='undefined')module.exports=ConfirmedRanges;
root.ConfirmedRanges=ConfirmedRanges;
})(typeof window==='undefined'?globalThis:window);
