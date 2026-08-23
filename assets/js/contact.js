/* contact.html — client-side validation for the demo request. No backend: submit resolves locally. */
(function(){
  var form=document.getElementById('demo-form');
  if(!form)return;
  var S=window.Shule,
      panel=document.getElementById('form-panel'),
      done=document.getElementById('done-panel'),
      formErr=document.getElementById('form-error'),
      again=document.getElementById('again');

  var f={};
  ['school','name','role','email','phone','pupils','current-system','message'].forEach(function(id){
    f[id]=document.getElementById(id);
  });

  var RULES={
    school:function(v){ if(!v.trim())return 'Enter your school name.';
                        if(v.trim().length<2)return 'That looks too short to be a school name.'; },
    name:function(v){   if(!v.trim())return 'Enter your name so we know who to ask for.';
                        if(v.trim().length<2)return 'Enter your full name.'; },
    role:function(v){   if(!v)return 'Select your role at the school.'; },
    email:function(v){  if(!v.trim())return 'Enter an email address.';
                        if(!S.isEmail(v))return 'That does not look like an email address — check for a missing @ or domain.'; },
    phone:function(v){  if(!v.trim())return 'Enter a phone number we can reach you on.';
                        if(!S.isPhone(v))return 'Digits only, please — for example 0712 345 678.'; },
    pupils:function(v){ if(!v.trim())return 'Enter roughly how many pupils are enrolled.';
                        if(!S.isInt(v))return 'Enter a whole number of pupils, with no letters or symbols.';
                        if(+v>20000)return 'That is more than 20,000 pupils — talk to us directly about a group price.'; },
    'current-system':function(v){ if(!v)return 'Tell us what you use today, even if the answer is nothing.'; }
    /* message is optional and has no rule */
  };

  function check(id){
    var el=f[id],rule=RULES[id];
    if(!el||!rule)return true;
    return S.setError(el,rule(el.value)||'');
  }

  Object.keys(RULES).forEach(function(id){
    var el=f[id];
    if(!el)return;
    el.addEventListener('blur',function(){check(id)});
    // once a field is marked bad, re-check as the visitor fixes it
    el.addEventListener('input',function(){
      if(el.getAttribute('aria-invalid')==='true')check(id);
    });
    el.addEventListener('change',function(){
      if(el.getAttribute('aria-invalid')==='true')check(id);
    });
  });

  form.addEventListener('submit',function(e){
    e.preventDefault();
    var bad=Object.keys(RULES).filter(function(id){return !check(id)});
    if(bad.length){
      formErr.textContent=bad.length===1
        ? 'One field needs attention before we can send this.'
        : bad.length+' fields need attention before we can send this.';
      formErr.classList.add('on');
      S.focusFirst(form);
      return;
    }
    formErr.classList.remove('on');
    formErr.textContent='';

    document.getElementById('done-school').textContent=f.school.value.trim();
    document.getElementById('done-name').textContent=f.name.value.trim();
    document.getElementById('done-email').textContent=f.email.value.trim();
    document.getElementById('done-phone').textContent=f.phone.value.trim();
    document.getElementById('done-pupils').textContent=f.pupils.value.trim();

    panel.hidden=true;
    done.hidden=false;
    done.setAttribute('tabindex','-1');
    done.focus();
    done.scrollIntoView({block:'center',behavior:'smooth'});
  });

  if(again){
    again.addEventListener('click',function(){
      form.reset();
      Object.keys(RULES).forEach(function(id){if(f[id])S.setError(f[id],'')});
      done.hidden=true;
      panel.hidden=false;
      f.school.focus();
      panel.scrollIntoView({block:'start',behavior:'smooth'});
    });
  }
})();
