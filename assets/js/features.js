/* features.html — highlights the module currently in view in the sticky contents rail. */
(function(){
  var toc=document.getElementById('toc');
  if(!toc)return;
  var links=Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
  if(!links.length||!('IntersectionObserver' in window))return;

  var byId={},sections=[];
  links.forEach(function(a){
    var el=document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
    if(el){byId[el.id]=a;sections.push(el)}
  });

  var visible=new Set(),current=null;
  function mark(id){
    if(id===current)return;
    current=id;
    links.forEach(function(a){a.removeAttribute('aria-current')});
    if(byId[id])byId[id].setAttribute('aria-current','true');
  }
  function pick(){
    if(visible.size){
      // topmost section currently in the viewport band
      var best=null;
      sections.forEach(function(s){
        if(visible.has(s.id)&&(!best||s.offsetTop<best.offsetTop))best=s;
      });
      if(best)mark(best.id);
      return;
    }
    // nothing in the band: fall back to the last section scrolled past
    var last=sections[0];
    sections.forEach(function(s){if(s.getBoundingClientRect().top<140)last=s});
    mark(last.id);
  }

  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(e.isIntersecting)visible.add(e.target.id);else visible.delete(e.target.id);
    });
    pick();
  },{rootMargin:'-96px 0px -62% 0px',threshold:0});

  sections.forEach(function(s){io.observe(s)});
  pick();
})();
