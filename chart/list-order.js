/* Visual list order only. Does not change chart/replay namespaces or drawings. */
const ListOrder = (()=>{
 const key='btt2_list_order_v1';let orders={};try{orders=JSON.parse(localStorage.getItem(key)||'{}');}catch(_){}
 if(!orders||typeof orders!=='object'||Array.isArray(orders))orders={};
 function sort(group,items,id=x=>x){const saved=Array.isArray(orders[group])?orders[group]:[],rank=new Map(saved.map((v,i)=>[String(v),i]));return items.slice().sort((a,b)=>(rank.get(String(id(a)))??Infinity)-(rank.get(String(id(b)))??Infinity));}
 let drag=null,suppressUntil=0;
 const rows=group=>Array.from(document.querySelectorAll('[data-order-group]')).filter(r=>r.dataset.orderGroup===group);
 function save(group){const next=rows(group).map(r=>r.dataset.orderId);const previous=orders[group];orders[group]=next;try{localStorage.setItem(key,JSON.stringify(orders));}catch(_){orders[group]=previous;showHint('Could not save list order: browser storage is full.');}}
 function targetAt(x,y){const hit=document.elementFromPoint(x,y)?.closest('[data-order-group]');if(!drag||!hit||hit===drag.row||hit.dataset.orderGroup!==drag.group)return;const r=hit.getBoundingClientRect();hit.parentNode.insertBefore(drag.row,y<r.top+r.height/2?hit:hit.nextSibling);try{drag.capture.setPointerCapture(drag.pointerId);}catch(_){}}
 function scroll(){if(!drag?.active)return;const host=document.getElementById('watchlist'),r=host.getBoundingClientRect();const d=drag.y<r.top+40?-9:drag.y>r.bottom-40?9:0;if(d){host.scrollTop+=d;targetAt(drag.x,drag.y);}drag.raf=requestAnimationFrame(scroll);}
 function activate(){if(!drag)return;drag.active=true;drag.row.classList.add('list-dragging');drag.row.setAttribute('aria-grabbed','true');scroll();}
 function finish(cancel=false){if(!drag)return;const d=drag;clearTimeout(d.timer);cancelAnimationFrame(d.raf);d.row.classList.remove('list-dragging');d.row.setAttribute('aria-grabbed','false');try{d.capture.releasePointerCapture(d.pointerId);}catch(_){}if(d.active){suppressUntil=Date.now()+600;if(cancel){if(d.next?.parentNode===d.parent)d.parent.insertBefore(d.row,d.next);else d.parent.append(d.row);}else save(d.group);}drag=null;}
 function bind(row,group,id){row.dataset.orderGroup=group;row.dataset.orderId=String(id);row.setAttribute('aria-grabbed','false');
  row.addEventListener('pointerdown',e=>{
   if(e.button!==0||drag||e.target.closest('.wl-star,.obs-star,.obs-eye,.obs-actions,input')||(e.target.closest('button')&&!e.target.closest('.obs-name')))return;
   drag={row,group,capture:e.target,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false,parent:row.parentNode,next:row.nextSibling,touch:e.pointerType==='touch'};
   if(drag.touch)drag.timer=setTimeout(activate,300);
   try{drag.capture.setPointerCapture(e.pointerId);}catch(_){}
  });
  row.addEventListener('pointermove',e=>{if(!drag||drag.row!==row)return;const oldY=drag.y;drag.x=e.clientX;drag.y=e.clientY;
   if(!drag.active){if(drag.touch){if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>8){clearTimeout(drag.timer);document.getElementById('watchlist').scrollTop+=oldY-e.clientY;drag.scrolled=true;}}else if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>5)activate();}
   if(drag.active){e.preventDefault();targetAt(e.clientX,e.clientY);}
  });
  row.addEventListener('pointerup',()=>{if(drag?.row===row){if(drag.scrolled)suppressUntil=Date.now()+600;finish();}});
  row.addEventListener('pointercancel',()=>{if(drag?.row===row)finish(true);});
  row.addEventListener('contextmenu',e=>{if(drag?.active){e.preventDefault();e.stopPropagation();}},true);
  row.addEventListener('click',e=>{if(Date.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
 }
 document.addEventListener('keydown',e=>{if(e.key==='Escape')finish(true);});
 return {sort,bind};
})();
