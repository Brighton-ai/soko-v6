/* Shule — shared shell behaviour. Loaded by every page. */
(function(){
  var nav=document.getElementById('nav');
  if(nav){
    var s=function(){nav.classList.toggle('stuck',window.scrollY>8)};
    s();window.addEventListener('scroll',s,{passive:true});
  }

  var b=document.getElementById('burger'),d=document.getElementById('drawer');
  if(b&&d){
    b.addEventListener('click',function(){
      var o=d.classList.toggle('open');b.setAttribute('aria-expanded',String(o));
    });
    d.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click',function(){d.classList.remove('open');b.setAttribute('aria-expanded','false')});
    });
  }

  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var items=document.querySelectorAll('.rv');
  if(reduce||!('IntersectionObserver' in window)){
    items.forEach(function(el){el.classList.add('in')});
    document.querySelectorAll('[data-c]').forEach(function(n){n.textContent=n.dataset.c});
  }else{
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(!e.isIntersecting)return;
        e.target.classList.add('in');
        e.target.querySelectorAll('[data-c]').forEach(function(n){
          var end=+n.dataset.c,t0=null;
          requestAnimationFrame(function step(t){
            if(!t0)t0=t;var p=Math.min((t-t0)/900,1);
            n.textContent=Math.round(end*(1-Math.pow(1-p,3)));
            if(p<1)requestAnimationFrame(step);
          });
        });
        io.unobserve(e.target);
      });
    },{threshold:.1,rootMargin:'0px 0px -40px'});
    items.forEach(function(el){io.observe(el)});
  }
})();

/* Shared form helpers, used by contact.html and login.html. */
window.Shule=(function(){
  function setError(input,msg){
    var box=document.getElementById(input.id+'-err');
    if(msg){
      input.setAttribute('aria-invalid','true');
      if(box){box.textContent=msg;box.classList.add('on')}
    }else{
      input.setAttribute('aria-invalid','false');
      if(box){box.textContent='';box.classList.remove('on')}
    }
    return !msg;
  }
  function isEmail(v){return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim())}
  function digits(v){return v.replace(/[\s+()-]/g,'')}
  function isPhone(v){var d=digits(v);return /^\d+$/.test(d)&&d.length>=9&&d.length<=13}
  function isInt(v){return /^\d+$/.test(v.trim())&&+v>0}
  function focusFirst(form){
    var bad=form.querySelector('[aria-invalid="true"]');
    if(bad)bad.focus();
  }
  return {setError:setError,isEmail:isEmail,isPhone:isPhone,isInt:isInt,digits:digits,focusFirst:focusFirst};
})();
