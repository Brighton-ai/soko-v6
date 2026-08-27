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

    // Signing in used to resolve here, in the browser: the form checked the
    // shape of an email address, wrote a role to localStorage and redirected.
    // Anyone who typed anything was inside, as a school administrator.
    var btn=form.querySelector('button[type="submit"]');
    var label=btn?btn.textContent:'';
    function busy(on){
      if(!btn)return;
      btn.disabled=on;
      btn.textContent=on?'Signing in…':label;
    }
    function fail(msg){
      busy(false);
      ok.classList.remove('on');
      var box=document.getElementById('login-error');
      if(!box){
        box=document.createElement('p');
        box.id='login-error';
        box.className='lform__err';
        box.setAttribute('role','alert');
        form.insertBefore(box,form.firstChild);
      }
      box.textContent=msg;
      box.hidden=false;
      pw.focus();
    }

    busy(true);
    window.ShuleAPI.login(id.value.trim(),pw.value,{role:role()}).then(function(res){
      // The role gates the sidebar. It comes from the account, not from which
      // tab the visitor happened to click — a parent choosing "School admin"
      // must not get a bursar's screens.
      var accountRole=(res&&res.user&&(res.user.role_name||res.user.role))||role();
      try{window.localStorage.setItem('shule.role',
        /teach/i.test(accountRole)?'teacher':
        /parent|guardian/i.test(accountRole)?'parent':'admin')}catch(e){}

      if(res&&res.requires_2fa){
        fail('This account uses two-step sign-in. That screen is not built yet — '+
             'ask the school office to turn it off, or use another account.');
        return;
      }
      var target=form.getAttribute('data-redirect');
      ok.innerHTML='<b>Signed in.</b> Taking you to your dashboard…';
      ok.classList.add('on');
      var box=document.getElementById('login-error'); if(box)box.hidden=true;
      setTimeout(function(){window.location.href=target},400);
    }).catch(function(err){
      var status=err&&err.status;
      if(status===401)      fail('That email address and password do not match an account.');
      else if(status===403) fail((err.message)||'Confirm your email address before signing in.');
      else if(status===423) fail(err.message||'This account is locked for a few minutes after too many attempts.');
      else if(status===429) fail('Too many attempts. Wait a minute and try again.');
      else if(status===0||status===408||status===503)
        fail('We cannot reach the school system. Check your connection and try again.');
      else fail(err&&err.message?err.message:'Sign-in failed. Try again, or tell the school office.');
    });
  });

  applyRole();
})();
