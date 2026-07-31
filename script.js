const FALLBACK_NAMES = ["Marta","Sandra","Jorge","Pedro","Ángel P.","Ángel T.","Francisco","Victor","Azeddine","Santiago","Bryan","Josue"];
const STORAGE_KEY = "noc-ruleta-relevos-v1";
let FIXED_NAMES = [];
let NAME_COLORS = {};
const WHEEL_TEXT_COLOR = "#20263F";
const TURNO_COLORS = {
  "Mañana": "#B7D3EF",
  "Tarde": "#EFEFB7",
  "Noche": "#D3B7EF"
};
const R_OUTER = 145;
const R_LABEL = 95;

function generateNameColors(names){
  const n = names.length || 1;
  const colors = {};
  names.forEach((name, i) => {
    const hue = Math.round((360 * i) / n);
    colors[name] = `hsl(${hue}, 65%, 83%)`;
  });
  return colors;
}

async function loadTeamFromServer(){
  try{
    const res = await fetch(LOG_ENDPOINT + (LOG_ENDPOINT.includes('?') ? '&' : '?') + 'action=team');
    const names = await res.json();
    if(Array.isArray(names) && names.length > 0) return names;
  }catch(err){
    console.warn('No se pudo cargar el equipo desde el servidor, usando lista de respaldo', err);
  }
  return FALLBACK_NAMES;
}

let audioCtx = null;
function getAudioCtx(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTick(volume){
  try{
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 950 + Math.random()*150;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.035);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  }catch(err){}
}

function makeBezierEasing(mX1, mY1, mX2, mY2){
  const A = (a1,a2) => 1.0-3.0*a2+3.0*a1;
  const B = (a1,a2) => 3.0*a2-6.0*a1;
  const C = (a1) => 3.0*a1;
  const calcBezier = (t,a1,a2) => ((A(a1,a2)*t+B(a1,a2))*t+C(a1))*t;
  const getSlope = (t,a1,a2) => 3.0*A(a1,a2)*t*t+2.0*B(a1,a2)*t+C(a1);
  function getTForX(aX){
    let t = aX;
    for(let i=0;i<6;i++){
      const slope = getSlope(t, mX1, mX2);
      if(slope === 0) return t;
      t -= (calcBezier(t, mX1, mX2) - aX) / slope;
    }
    return t;
  }
  return (x) => calcBezier(getTForX(x), mY1, mY2);
}

const spinEase = makeBezierEasing(0.12, 0.72, 0.15, 1);

function timeForProgress(p){
  let lo = 0, hi = 1;
  for(let i=0;i<20;i++){
    const mid = (lo+hi)/2;
    if(spinEase(mid) < p) lo = mid; else hi = mid;
  }
  return (lo+hi)/2;
}

function scheduleSpinTicks(totalDelta, segAngle, durationMs){
  const totalTicks = Math.min(180, Math.max(1, Math.round(totalDelta/segAngle)));
  for(let i=1;i<=totalTicks;i++){
    const p = i/totalTicks;
    const t = timeForProgress(p);
    const ms = t*durationMs;
    const volume = 0.22 - (p*0.13);
    setTimeout(() => playTick(volume), ms);
  }
}

let selected = new Set();
let history = [];
let spinning = false;
let currentRotation = 0;

const wheel = document.getElementById('wheel');
const namesGrid = document.getElementById('namesGrid');
const spinBtn = document.getElementById('spinBtn');
const resultLabel = document.getElementById('resultLabel');
const resultName = document.getElementById('resultName');
const resultMeta = document.getElementById('resultMeta');
const resultCard = document.getElementById('resultCard');
const histBody = document.getElementById('histBody');
const summaryBars = document.getElementById('summaryBars');
const teamCount = document.getElementById('teamCount');
const selectWarning = document.getElementById('selectWarning');

// 👇 Pega aquí la URL que copiaste al desplegar el Apps Script (termina en /exec)
const LOG_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxh04qQdkC4AipzeAKTNdF0Gn8rDJZHuG7ihjZtggJJDIWgxUPbVw5Jdi22ErmrsbuuHg/exec';

function initLogSupport(){
  if(!LOG_ENDPOINT || LOG_ENDPOINT.indexOf('PEGA_AQUI') !== -1) return;
  fetchSharedHistory();
}

async function fetchSharedHistory(){
  try{
    const res = await fetch(LOG_ENDPOINT);
    if(!res.ok) return;
    const rows = await res.json();
    if(Array.isArray(rows) && rows.length > 0){
      history = rows;
      renderHistory();
      renderSummary();
      saveState();
    }
  }catch(err){
    console.warn('No se pudo leer el historial compartido', err);
  }
}

// initLogSupport() se llama ahora dentro de startApp(), tras el login

function activeNames(){
  return FIXED_NAMES.filter(n => selected.has(n));
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      selected: activeNames(),
      history: history
    }));
  }catch(err){
    console.warn('No se pudo guardar en localStorage', err);
  }
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(Array.isArray(data.selected) && data.selected.length > 0){
      selected = new Set(data.selected.filter(n => FIXED_NAMES.includes(n)));
    }
    if(Array.isArray(data.history)) history = data.history;
  }catch(err){
    console.warn('No se pudo leer localStorage', err);
  }
}

function buildNameInputs(){
  namesGrid.innerHTML = '';
  FIXED_NAMES.forEach((n) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = n;
    btn.style.backgroundColor = NAME_COLORS[n] || '#CFE3FF';
    btn.className = 'person-btn ' + (selected.has(n) ? 'active' : 'inactive');
    btn.addEventListener('click', () => {
      if(selected.has(n)) selected.delete(n); else selected.add(n);
      btn.className = 'person-btn ' + (selected.has(n) ? 'active' : 'inactive');
      updateTeamState();
      renderWheel();
      saveState();
    });
    namesGrid.appendChild(btn);
  });
  updateTeamState();
}

function updateTeamState(){
  const n = activeNames().length;
  teamCount.textContent = n + ' en turno';
  const canSpin = n >= 2;
  spinBtn.disabled = !canSpin || spinning;
  selectWarning.style.display = canSpin ? 'none' : 'block';
}

function renderWheel(){
  const names = activeNames();
  const n = names.length;

  if(n === 0){
    wheel.innerHTML = '';
    return;
  }

  const cx = 150, cy = 150;
  const seg = 360 / n;
  let svg = '';

  names.forEach((name, i) => {
    const startA = i*seg;
    const endA = (i+1)*seg;
    const startRad = startA * Math.PI/180;
    const endRad = endA * Math.PI/180;
    const x1 = cx + R_OUTER*Math.sin(startRad);
    const y1 = cy - R_OUTER*Math.cos(startRad);
    const x2 = cx + R_OUTER*Math.sin(endRad);
    const y2 = cy - R_OUTER*Math.cos(endRad);
    const largeArc = seg > 180 ? 1 : 0;
    const fill = NAME_COLORS[name] || '#CFE3FF';

    svg += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${R_OUTER},${R_OUTER} 0 ${largeArc},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${fill}" stroke="#080B14" stroke-width="2"></path>`;

    const mid = startA + seg/2;
    const midRad = mid * Math.PI/180;
    const tx = cx + R_LABEL*Math.sin(midRad);
    const ty = cy - R_LABEL*Math.cos(midRad);
    let rotate = mid <= 180 ? (mid - 90) : (mid - 270);

    svg += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" transform="rotate(${rotate.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)})" text-anchor="middle" dominant-baseline="middle" style="fill:${WHEEL_TEXT_COLOR};font-family:var(--mono);font-size:11px;font-weight:600;">${escapeHtml(name)}</text>`;
  });

  wheel.innerHTML = svg;
}

function tickClock(){
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
}
setInterval(tickClock, 1000);
tickClock();

let CONFETTI_COLORS = [];

function fireConfetti(container){
  const count = 26;
  for(let i=0;i<count;i++){
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    const color = CONFETTI_COLORS[Math.floor(Math.random()*CONFETTI_COLORS.length)];
    const left = Math.random()*100;
    const duration = 0.9 + Math.random()*0.7;
    const delay = Math.random()*0.15;
    const spin = (Math.random() > 0.5 ? 1 : -1) * (200 + Math.random()*400);
    const width = 4 + Math.random()*4;
    piece.style.left = left + '%';
    piece.style.background = color;
    piece.style.width = width + 'px';
    piece.style.height = (width*1.8) + 'px';
    piece.style.animationDuration = duration + 's';
    piece.style.animationDelay = delay + 's';
    piece.style.setProperty('--spin', spin + 'deg');
    container.appendChild(piece);
    setTimeout(() => piece.remove(), (duration+delay)*1000 + 100);
  }
}

async function spin(){
  const names = activeNames();
  if(spinning || names.length < 2) return;
  spinning = true;
  spinBtn.disabled = true;
  resultLabel.textContent = 'da el relevo';
  resultLabel.classList.remove('spinning-label');
  resultName.innerHTML = '<span class="dot-loader"><span></span><span></span><span></span></span>';
  resultMeta.textContent = 'conectando...';

  let serverResult;
  try{
    const res = await fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({action: 'spin', usuario: currentUsuarioFull, token: currentToken, activeNames: names})
    });
    serverResult = await res.json();
  }catch(err){
    serverResult = {status: 'error', message: 'No se pudo conectar con el servidor'};
  }

  if(serverResult.status !== 'ok'){
    resultName.textContent = '⚠️';
    resultName.style.color = 'var(--red)';
    resultMeta.textContent = serverResult.message || 'Error al girar';
    spinning = false;
    updateTeamState();
    return;
  }

  const winner = serverResult.nombre;
  const n = names.length;
  const seg = 360/n;
  const targetIndex = Math.max(0, names.indexOf(winner));
  const segCenter = targetIndex*seg + seg/2;
  const jitter = (Math.random()-0.5) * (seg*0.6);

  const desiredMod = ((360 - (segCenter+jitter)) % 360 + 360) % 360;
  const currentMod = ((currentRotation % 360) + 360) % 360;
  const deltaToDesired = (desiredMod - currentMod + 360) % 360;
  const extraSpins = 5 + Math.floor(Math.random()*3);
  const totalDelta = deltaToDesired + extraSpins*360;
  currentRotation += totalDelta;

  wheel.style.transform = `rotate(${currentRotation}deg)`;
  scheduleSpinTicks(totalDelta, seg, 5500);

  setTimeout(() => {
    const fecha = serverResult.fecha;
    const turno = serverResult.turno;
    history.unshift({fecha, nombre: winner, turno, giradoPor: currentUser});
    renderHistory();
    renderSummary();
    saveState();
    resultLabel.textContent = 'da el relevo';
    resultLabel.classList.remove('spinning-label');
    resultName.textContent = winner;
    resultName.style.color = NAME_COLORS[winner] || 'var(--text)';
    const turnoColor = TURNO_COLORS[turno] || '#CFE3FF';
    resultMeta.innerHTML = `${escapeHtml(fecha)} <span class="badge" style="background:${turnoColor};color:${WHEEL_TEXT_COLOR};border-color:transparent;">${escapeHtml(turno)}</span>`;
    fireConfetti(resultCard);
    spinning = false;
    updateTeamState();
  }, 5600);
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderHistory(){
  if(history.length === 0){
    histBody.innerHTML = '<tr class="empty-row"><td colspan="4">Aún no hay giros registrados</td></tr>';
    return;
  }
  histBody.innerHTML = history.map(h => `<tr><td>${escapeHtml(h.fecha)}</td><td>${escapeHtml(h.turno || '-')}</td><td>${escapeHtml(h.nombre)}</td><td>${escapeHtml(h.giradoPor || '-')}</td></tr>`).join('');
}

function renderSummary(){
  const counts = {};
  FIXED_NAMES.forEach(n2 => counts[n2] = 0);
  history.forEach(h => { counts[h.nombre] = (counts[h.nombre]||0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  summaryBars.innerHTML = FIXED_NAMES.map(n2 => {
    const c = counts[n2] || 0;
    const pct = Math.round((c/max)*100);
    return `<div class="bar-row">
      <div class="bar-name">${escapeHtml(n2)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-count">${c}</div>
    </div>`;
  }).join('');
}

document.getElementById('exportBtn').addEventListener('click', () => {
  const data = JSON.stringify({selected: activeNames(), history}, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ruleta_relevos_copia.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try{
      const data = JSON.parse(ev.target.result);
      if(Array.isArray(data.selected)){
        selected = new Set(data.selected.filter(n => FIXED_NAMES.includes(n)));
      }
      if(Array.isArray(data.history)) history = data.history;
      buildNameInputs();
      renderWheel();
      renderHistory();
      renderSummary();
      saveState();
      resultMeta.textContent = 'copia importada correctamente';
    }catch(err){
      resultMeta.textContent = 'error: el archivo no es un JSON válido';
    }
  };
  reader.readAsText(file);
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if(!confirm('¿Seguro? Esto borra el historial guardado en este navegador.')) return;
  history = [];
  selected = new Set(FIXED_NAMES);
  buildNameInputs();
  renderWheel();
  renderHistory();
  renderSummary();
  saveState();
  resultLabel.textContent = 'da el relevo';
  resultLabel.classList.remove('spinning-label');
  resultName.textContent = '—';
  resultName.style.color = 'var(--text-mute)';
  resultMeta.textContent = 'esperando giro...';
});

spinBtn.addEventListener('click', spin);

function moveTabIndicator(btn){
  const indicator = document.getElementById('tabIndicator');
  if(!indicator) return;
  indicator.style.left = btn.offsetLeft + 'px';
  indicator.style.width = btn.offsetWidth + 'px';
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).classList.add('active');
    moveTabIndicator(btn);
  });
});

const initialActiveTab = document.querySelector('.tab-btn.active');
if(initialActiveTab) moveTabIndicator(initialActiveTab);

const ADMIN_USER = 'sandra';

let currentUser = '';
let currentUsuarioFull = '';
let currentToken = '';

async function startApp(){
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('appWrap').style.display = 'block';
  document.getElementById('topbarOuter').style.display = 'block';
  try{
    const raw = localStorage.getItem(LOGIN_KEY);
    if(raw){
      const data = JSON.parse(raw);
      currentUsuarioFull = data.usuario || '';
      currentUser = currentUsuarioFull.split('@')[0] || data.nombre || '';
      currentToken = data.token || '';
    }
  }catch(err){}

  const adminActions = document.getElementById('adminActions');
  const isAdmin = currentUser.toLowerCase() === ADMIN_USER;
  if(adminActions){
    adminActions.style.display = isAdmin ? 'flex' : 'none';
  }

  const adminBadge = document.getElementById('adminBadge');
  if(adminBadge) adminBadge.style.display = isAdmin ? 'inline-block' : 'none';

  const topbarUser = document.getElementById('topbarUser');
  if(topbarUser) topbarUser.textContent = currentUser || '—';

  document.getElementById('footerbarOuter').style.display = 'block';

  FIXED_NAMES = await loadTeamFromServer();
  NAME_COLORS = generateNameColors(FIXED_NAMES);
  CONFETTI_COLORS = Object.values(NAME_COLORS);
  selected = new Set(FIXED_NAMES);

  initLogSupport();
  loadState();
  buildNameInputs();
  renderWheel();
  renderHistory();
  renderSummary();
}

const LOGIN_KEY = 'noc-ruleta-login-v1';

function checkSavedLogin(){
  try{
    const raw = localStorage.getItem(LOGIN_KEY);
    if(!raw) return false;
    const data = JSON.parse(raw);
    return !!(data && data.usuario);
  }catch(err){
    return false;
  }
}

const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

loginForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const usuario = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  if(!usuario || !password) return;

  loginBtn.disabled = true;
  loginBtn.textContent = 'Entrando...';
  loginError.textContent = '';

  try{
    const res = await fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({action: 'login', usuario, password})
    });
    const data = await res.json();
    if(data.status === 'ok'){
      localStorage.setItem(LOGIN_KEY, JSON.stringify({usuario, nombre: data.nombre, token: data.token}));
      startApp();
    } else {
      loginError.textContent = data.message || 'Usuario o contraseña incorrectos';
    }
  }catch(err){
    loginError.textContent = 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.';
  }finally{
    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';
  }
});

if(checkSavedLogin()){
  startApp();
} else {
  document.getElementById('loginOverlay').style.display = 'flex';
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  if(!confirm('¿Cerrar sesión?')) return;
  localStorage.removeItem(LOGIN_KEY);
  location.reload();
});
