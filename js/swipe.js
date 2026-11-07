(function () {
  'use strict';
  var opened=null,cleanups=[];
  function intent(dx,dy){if(Math.max(Math.abs(dx),Math.abs(dy))<10)return'pending';if(Math.abs(dx)>Math.abs(dy)*1.5)return dx>0?'left':'right';return'vertical';}
  function setOpen(row,side){if(opened&&opened!==row)setOpen(opened,false);if(side===true)side='right';if(side==='left'&&row.querySelector('.row-left')&&!row.querySelector('.row-left button'))side=false;row.classList.toggle('actions-open',!!side);['left','right','menu'].forEach(function(k){row.classList.toggle('actions-'+k,side===k);});var menu=row.querySelector('.row-menu'),panel=row.querySelector('.row-actions');if(menu)menu.setAttribute('aria-expanded',String(!!side));if(panel)panel.hidden=!side;var left=row.querySelector('.row-left'),right=row.querySelector('.row-right');if(left)left.hidden=side!=='left'&&side!=='menu';if(right)right.hidden=side!=='right'&&side!=='menu';opened=side?row:(opened===row?null:opened);}
  function attach(row,surface,options){if(!row.querySelector('.row-actions'))return;options=options||{};var start=null,timer=null,suppress=0,drag=null;
    function cancel(){if(timer!==null)clearTimeout(timer);timer=null;}
    function end(e,cancelled){cancel();if(drag){var group=row.dataset.group,peers=Array.from(row.parentElement.querySelectorAll('.record-row')).filter(function(r){return r.dataset.group===group;}),keys=peers.map(function(r){return r.dataset.key;}),old=keys.indexOf(row.dataset.key),others=peers.filter(function(r){return r!==row;}),at=others.filter(function(r){var box=r.getBoundingClientRect();return e.clientY>box.top+box.height/2;}).length;row.classList.toggle('reordering',false);surface.style.transform='';drag=null;suppress=Date.now()+600;if(!cancelled&&old>=0&&at!==old){keys.splice(old,1);keys.splice(at,0,row.dataset.key);options.reorder(keys);}}
      else if(start&&start.horizontal&&!cancelled){var dx=e.clientX-start.x;setOpen(row,Math.abs(dx)>=60?(dx>0?'left':'right'):false);suppress=Date.now()+600;}start=null;}
    function down(e){if(e.isPrimary===false||(e.pointerType==='mouse'&&e.button!==0))return;if(opened&&opened!==row)setOpen(opened,false);cancel();start={x:e.clientX,y:e.clientY,id:e.pointerId,horizontal:false};if(options.canReorder&&options.canReorder())timer=setTimeout(function(){if(!start)return;drag=true;setOpen(row,false);row.classList.toggle('reordering',true);if(surface.setPointerCapture)surface.setPointerCapture(start.id);},450);}
    function move(e){if(!start||e.pointerId!==start.id)return;var dx=e.clientX-start.x,dy=e.clientY-start.y;if(drag){e.preventDefault();surface.style.transform='translateY('+dy+'px)';if(options.container){var bounds=options.container.getBoundingClientRect();if(e.clientY<bounds.top+32)options.container.scrollTop-=12;else if(e.clientY>bounds.bottom-32)options.container.scrollTop+=12;}return;}if(Math.abs(dx)>8||Math.abs(dy)>8)cancel();var direction=intent(dx,dy);if(direction==='vertical'){suppress=Date.now()+500;start=null;return;}if(direction!=='pending'){start.horizontal=true;e.preventDefault();}}
    surface.addEventListener('pointerdown',down);surface.addEventListener('pointermove',move,{passive:false});surface.addEventListener('pointerup',function(e){if(start&&e.pointerId===start.id)end(e,false);});surface.addEventListener('pointercancel',function(e){end(e,true);});
    surface.addEventListener('click',function(e){if(Date.now()<suppress){e.preventDefault();e.stopImmediatePropagation();}},true);
    row.addEventListener('contextmenu',function(e){if(options.canReorder&&options.canReorder())e.preventDefault();});
    row.addEventListener('keydown',function(e){if(e.key==='Escape'){setOpen(row,false);row.querySelector('.row-menu').focus();e.preventDefault();}});
    cleanups.push(function(){cancel();start=null;drag=null;});
  }
  function dispose(){cleanups.forEach(function(f){f();});cleanups=[];opened=null;}
  window.Swipe={intent:intent,setOpen:setOpen,attach:attach,dispose:dispose};
})();
