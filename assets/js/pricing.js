/* pricing.html — fee-recovery calculator. Runs entirely in the browser, no submit. */
(function(){
  var pupils=document.getElementById('calc-pupils'),
      fee=document.getElementById('calc-fee'),
      arrears=document.getElementById('calc-arrears'),
      plan=document.getElementById('calc-plan');
  if(!pupils||!fee||!arrears||!plan)return;

  var TERMS=3;
  var out={
    billed:document.getElementById('out-billed'),
    billedSub:document.getElementById('out-billed-sub'),
    arrears:document.getElementById('out-arrears'),
    arrearsSub:document.getElementById('out-arrears-sub'),
    cost:document.getElementById('out-cost'),
    costSub:document.getElementById('out-cost-sub'),
    be:document.getElementById('out-breakeven'),
    beSub:document.getElementById('out-breakeven-sub'),
    bar:document.getElementById('out-bar'),
    barWrap:document.getElementById('out-bar-wrap'),
    verdict:document.getElementById('out-verdict')
  };

  var nf=new Intl.NumberFormat('en-KE',{maximumFractionDigits:0});
  function kes(n){return 'KES '+nf.format(Math.round(n))}
  function clamp(v,lo,hi){return Math.min(hi,Math.max(lo,v))}
  function num(el,lo,hi,fallback){
    var v=parseFloat(el.value);
    return isNaN(v)?fallback:clamp(v,lo,hi);
  }

  function run(){
    var p=Math.round(num(pupils,1,20000,1)),
        f=num(fee,0,500000,0),
        a=num(arrears,0,100,0),
        rate=parseFloat(plan.value)||0;

    var billed  = p*f*TERMS,
        unpaid  = billed*(a/100),
        cost    = p*rate*TERMS;

    out.billed.textContent=kes(billed);
    out.billedSub.textContent=nf.format(p)+(p===1?' pupil':' pupils')+' · '+TERMS+' terms';
    out.arrears.textContent=kes(unpaid);
    out.arrearsSub.textContent='at '+(Math.round(a*10)/10)+'% arrears';
    out.cost.textContent=kes(cost);
    out.costSub.textContent=(rate===90?'Starter':'School')+' plan · '+TERMS+' terms';

    if(unpaid<=0){
      out.be.textContent='—';
      out.beSub.textContent='no arrears to recover';
      out.bar.style.width='0%';
      out.barWrap.setAttribute('aria-label','No arrears entered');
      out.verdict.innerHTML='<b>No arrears entered.</b> At full collection Shule costs '+kes(cost)+
        ' a year — set the arrears percentage to what your school actually carries to see the trade.';
      return;
    }

    var be=cost/unpaid*100;
    out.be.textContent=(be>=100?Math.round(be):Math.round(be*10)/10)+'%';
    out.beSub.textContent='of arrears pays for the year';
    out.bar.style.width=clamp(be,0,100).toFixed(1)+'%';
    out.barWrap.setAttribute('aria-label',
      'The subscription is '+(Math.round(be*10)/10)+' percent of annual arrears');

    if(be<100){
      out.verdict.innerHTML='<b>Recover '+(Math.round(be*10)/10)+'% of what you are owed and the year pays for itself.</b> '+
        'Everything beyond that is fees you were already owed, collected. Recovering half of '+kes(unpaid)+
        ' would return '+kes(unpaid/2-cost)+' net of the subscription.';
    }else{
      out.verdict.innerHTML='<b>At these numbers the subscription is larger than the arrears.</b> '+
        'Shule would cost '+kes(cost)+' a year against '+kes(unpaid)+' uncollected — talk to us about the Starter plan or a group price before you decide.';
    }
  }

  [pupils,fee,arrears].forEach(function(el){el.addEventListener('input',run)});
  plan.addEventListener('change',run);
  run();
})();
