/* login.html — role toggle, validation, and a local resolve that redirects to the app shell. */
(function(){
  var form=document.getElementById('login-form');
  if(!form)return;
  var S=window.Shule,
      id=document.getElementById('login-id'),
      idLabel=document.getElementById('login-id-label'),
      pw=document.getElementById('login-pw'),
      toggle=document.getElementById('pw-toggle'),
      ok=document.getElementById('login-ok'),
      note=document.getElementById('role-note'),
      radios=Array.prototype.slice.call(form.querySelectorAll('input[name="role"]'));

  var COPY={
    admin:{label:'Email address',ph:'you@school.co.ke',ac:'username',
      note:'School admins sign in with the address the school issued. Your account can see every module the school has activated.'},
    teacher:{label:'Email address',ph:'you@school.co.ke',ac:'username',
      note:'Teachers see the classes and subjects assigned to them — their register, their mark entry, their timetable.'},
    parent:{label:'Email or phone number',ph:'0712 345 678',ac:'username',
      note:'Parents can sign in with the phone number registered against their child instead of an email address.'}
  };

  function role(){
    var r=radios.filter(function(x){return x.checked})[0];
    return r?r.value:'admin';
  }
  function applyRole(){
    var c=COPY[role()];
    idLabel.textContent=c.label;
    id.placeholder=c.ph;
    id.setAttribute('autocomplete',c.ac);
    note.textContent=c.note;
    if(id.getAttribute('aria-invalid')==='true')checkId();
  }
  radios.forEach(function(r){r.addEventListener('change',applyRole)});

  function checkId(){
    var v=id.value.trim(),parent=role()==='parent';
    if(!v)return S.setError(id,parent?'Enter your email address or phone number.':'Enter your email address.');
    if(parent){
      if(!S.isEmail(v)&&!S.isPhone(v))
        return S.setError(id,'Enter a valid email address, or a phone number in digits — for example 0712 345 678.');
      return S.setError(id,'');
    }
    if(!S.isEmail(v))return S.setError(id,'That does not look like an email address. Parents signing in with a phone number should switch to the Parent tab.');
    return S.setError(id,'');
  }
  function checkPw(){
    var v=pw.value;
    if(!v)return S.setError(pw,'Enter your password.');
    if(v.length<8)return S.setError(pw,'Passwords are at least 8 characters.');
    return S.setError(pw,'');
  }

  id.addEventListener('blur',checkId);
  pw.addEventListener('blur',checkPw);
  id.addEventListener('input',function(){if(id.getAttribute('aria-invalid')==='true')checkId()});
  pw.addEventListener('input',function(){if(pw.getAttribute('aria-invalid')==='true')checkPw()});

  if(toggle){
    toggle.addEventListener('click',function(){
      var shown=pw.type==='text';
      pw.type=shown?'password':'text';
      toggle.setAttribute('aria-pressed',String(!shown));
      toggle.setAttribute('aria-label',shown?'Show password':'Hide password');
      pw.focus();
    });
  }

  form.addEventListener('submit',function(e){
    e.preventDefault();
    var a=checkId(),b=checkPw();
    if(!a||!b){ok.classList.remove('on');S.focusFirst(form);return}

    // No backend yet: the sign-in resolves locally. The chosen role is handed to
    // the app shell through localStorage, which reads it on load and gates the
    // sidebar. Step 4 replaces this with a real session from the API.
    var target=form.getAttribute('data-redirect');
    try{window.localStorage.setItem('shule.role',role())}catch(e){/* private mode: the shell falls back to admin */}
    ok.innerHTML='<b>Signed in as '+role().replace('admin','school admin')+'.</b> Taking you to your dashboard…';
    ok.classList.add('on');
    setTimeout(function(){window.location.href=target},700);
  });

  applyRole();
})();
