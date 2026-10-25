const socket = io();
const $ = id => document.getElementById(id);
const screens = { lobby:$('lobby'), room:$('room'), game:$('game') };
let roomState=null, myHand=[], myId=null, pendingWildCard=null, toastTimer=null;
let voiceAnnouncementsEnabled = true;
let lastUnoAnnouncement = '';
let speechVoices = [];
if ('speechSynthesis' in window) { speechVoices = window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => { speechVoices = window.speechSynthesis.getVoices(); }; }
socket.on('connect',()=>{myId=socket.id;});
socket.on('state',state=>{roomState=state;if(state.started)showScreen('game');else if(state.code)showScreen('room');else showScreen('lobby');renderRoom();renderGame();});
socket.on('hand',hand=>{myHand=Array.isArray(hand)?hand:[];renderGame();});
socket.on('notice',message=>{showToast(message);if($('gameMessage'))$('gameMessage').textContent=message;announceUno(message);});
function announceUno(message){
  if(!voiceAnnouncementsEnabled || !('speechSynthesis' in window) || typeof message!=='string') return;
  const match = message.match(/(?:📣\s*)?(.+?)\s+calls UNO!/i);
  if(!match) return;
  const playerName = match[1].trim();
  const uniqueKey = `${roomState?.code || ''}:${playerName}:${Date.now()}`;
  if(uniqueKey===lastUnoAnnouncement) return;
  lastUnoAnnouncement=uniqueKey;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${playerName} says UNO!`);
    utterance.lang = 'en-US'; utterance.rate = 0.88; utterance.pitch = 1.08; utterance.volume = 1;
    const preferred = speechVoices.find(v => /Google US English|Samantha|Microsoft Aria|English.*United States/i.test(v.name+' '+v.lang)) || speechVoices.find(v => /^en/i.test(v.lang));
    if(preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  } catch(err) { console.warn('UNO voice announcement unavailable:', err); }
}
socket.on('connect_error',()=>{setJoinError('Cannot connect to the game server. Make sure backend is running.');showToast('Connection problem. Check the backend terminal.');});
function showScreen(name){Object.entries(screens).forEach(([key,el])=>el.classList.toggle('hidden',key!==name));}
function showToast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3400);}
function setJoinError(message){$('joinError').textContent=message||'';$('lobbyError').textContent=message||'';$('roomCode').setAttribute('aria-invalid',message?'true':'false');}
function request(event,payload){return new Promise(resolve=>{socket.emit(event,payload,result=>{const r=result||{ok:false,error:'No response from server.'};if(!r.ok){if(event==='joinRoom')setJoinError(r.error);showToast(r.error||'Something went wrong.');}else if(event==='joinRoom')setJoinError('');resolve(r);});});}
function cleanName(id){const value=$(id).value.trim();if(!value){if(id==='joinPlayerName')setJoinError('Enter your player name first.');else{$('lobbyError').textContent='Enter your player name first.';$(id).focus();}return null;}return value;}
async function createRoom(){const name=cleanName('playerName');if(!name)return;const btn=$('createBtn');btn.disabled=true;const result=await request('createRoom',{name,maxPlayers:Number($('maxPlayers').value||10),rules:{winTarget:$('winTarget')?.value||'500',stacking:!!$('stacking')?.checked,sevenZero:!!$('sevenZero')?.checked,jumpIn:!!$('jumpIn')?.checked}});btn.disabled=false;if(result.ok)$('lobbyError').textContent='';}
async function joinRoom(){setJoinError('');const name=cleanName('joinPlayerName');if(!name)return;const code=$('roomCode').value.trim().toUpperCase();if(!code){setJoinError('Enter the room code shared by the host.');$('roomCode').focus();return;}if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){setJoinError('Invalid code format. The room code must be 6 letters/numbers.');return;}const btn=$('joinBtn');btn.disabled=true;const result=await request('joinRoom',{name,code});btn.disabled=false;if(!result.ok)$('roomCode').focus();}
$('createBtn').addEventListener('click',createRoom);$('createRoomAlt').addEventListener('click',createRoom);$('joinBtn').addEventListener('click',joinRoom);
$('roomCode').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);setJoinError('');});
$('roomCode').addEventListener('keydown',e=>{if(e.key==='Enter')joinRoom();});$('joinPlayerName').addEventListener('keydown',e=>{if(e.key==='Enter')$('roomCode').focus();});$('playerName').addEventListener('keydown',e=>{if(e.key==='Enter')createRoom();});
$('heroJoinBtn').addEventListener('click',()=>{$('joinPlayerName').focus();$('joinPlayerName').scrollIntoView({behavior:'smooth',block:'center'});});
$('copyCodeBtn').addEventListener('click',()=>copyRoomCode());$('copyGameCode').addEventListener('click',()=>copyRoomCode());
async function copyRoomCode(){if(!roomState?.code)return;try{await navigator.clipboard.writeText(roomState.code);showToast('Room code copied! Share it with your friends.');}catch{showToast('Room code: '+roomState.code);}}
$('startBtn').addEventListener('click',async()=>{const r=await request('startGame');if(r.ok)showToast('Dealing cards…');});
$('leaveBtn').addEventListener('click',leaveRoom);$('gameLeaveBtn').addEventListener('click',leaveRoom);
function leaveRoom(){socket.emit('leaveRoom');roomState=null;myHand=[];pendingWildCard=null;showScreen('lobby');}
$('drawBtn').addEventListener('click',async()=>{if(!isMyTurn())return showToast('Wait for your turn.');const r=await request('drawCard');if(r.ok){$('passBtn').classList.remove('hidden');}});
$('passBtn').addEventListener('click',async()=>{const r=await request('passTurn');if(r.ok)$('passBtn').classList.add('hidden');});
$('unoBtn').addEventListener('click',async()=>{const r=await request('callUno');if(r.ok)showToast('UNO called! Voice announcement sent to players. 📣');});
$('catchUnoBtn').addEventListener('click',()=>{if(!roomState)return;const target=roomState.players.find(p=>p.id!==socket.id&&p.count===1&&!p.calledUno);if(!target)return showToast('No player can be caught right now.');request('catchUno',{playerId:target.id});});
$('challengeBtn').addEventListener('click',async()=>{const r=await request('challengeWild4');if(r.ok)showToast('Challenge resolved.');});
$('acceptBtn').addEventListener('click',async()=>{const r=await request('acceptWild4');if(r.ok)showToast('You accepted +4.');});
document.querySelectorAll('.color-choice').forEach(btn=>btn.addEventListener('click',async()=>{const color=btn.dataset.color;$('colorModal').classList.add('hidden');if(pendingWildCard==null)return;const id=pendingWildCard;pendingWildCard=null;const r=await request('playCard',{cardId:id,chosenColor:color});if(!r.ok)pendingWildCard=null;}));
function isMyTurn(){return !!roomState&&roomState.started&&roomState.currentPlayerId===socket.id&&!roomState.winnerId;}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderRoom(){if(!roomState)return;$('displayCode').textContent=roomState.code;$('playerCount').textContent=`${roomState.players.length}/${roomState.maxPlayers}`;const host=roomState.players.find(p=>p.id===roomState.hostId);$('roomTitle').textContent=`${host?.name||'Game'}’s Room`;$('hostName').textContent=host?.name||'Player';const r=roomState.rules||{};$('roomRules').textContent=`Rules: ${r.winTarget==='single'?'Single round':'First to '+(r.winTarget||500)+' points'} · Stacking ${r.stacking?'ON':'OFF'} · 7–0 ${r.sevenZero?'ON':'OFF'} · Jump-in ${r.jumpIn?'ON':'OFF'}`;$('playersList').innerHTML=roomState.players.map(p=>`<div class="player-row"><div class="avatar">${esc(p.name.charAt(0).toUpperCase())}</div><div class="player-name">${esc(p.name)}${p.id===socket.id?' (You)':''}</div><div class="player-sub">${p.id===roomState.hostId?'Room host':'Ready to play'}</div>${p.id===roomState.hostId?'<span class="host-tag">HOST</span>':''}</div>`).join('');const isHost=roomState.hostId===socket.id;$('startBtn').classList.toggle('hidden',!isHost);$('startHint').textContent=roomState.players.length<2?'Gather at least 2 players to start.':`${roomState.players.length} players are in. ${isHost?'You are the host — start when ready!':'Waiting for the host to start.'}`;$('startBtn').disabled=roomState.players.length<2;}
function renderGame(){if(!roomState||!roomState.started)return;$('gameCode').textContent=roomState.code;$('gamePlayerCount').textContent=`${roomState.players.length}/${roomState.maxPlayers}`;$('drawCount').textContent=roomState.drawCount;$('discardCount').textContent=roomState.discardCount;$('handCount').textContent=`${myHand.length} card${myHand.length===1?'':'s'}`;const current=roomState.players.find(p=>p.id===roomState.currentPlayerId),turn=isMyTurn(),challenge=roomState.pendingChallenge?.targetId===socket.id; $('turnPill').textContent=turn?'● Turn: You':'● Turn: '+(current?.name||'—');$('turnBanner').textContent=challenge?'⚑ Challenge the Wild Draw Four or accept +4.':roomState.winnerId?`🏆 ${roomState.players.find(p=>p.id===roomState.winnerId)?.name||'A player'} wins the round!`:roomState.pendingDraw&&roomState.pendingDraw.targetId===socket.id?`Draw penalty: ${roomState.pendingDraw.amount} cards. Stack if enabled or draw.`:turn?roomState.drawnCardId?.playerId===socket.id?'You drew a card. Play it if legal or pass.':'✨ YOUR TURN — play a matching card or draw one.':`⏳ ${current?.name||'Another player'} is playing…`;
$('drawBtn').disabled=!turn||!!roomState.winnerId||!!roomState.pendingChallenge||!!roomState.drawnCardId&&roomState.drawnCardId.playerId===socket.id;$('passBtn').classList.toggle('hidden',!(turn&&roomState.drawnCardId?.playerId===socket.id));$('passBtn').disabled=!turn||!roomState.drawnCardId;$('unoBtn').disabled=myHand.length!==1||!!roomState.winnerId;$('challengeBtn').disabled=!challenge;$('acceptBtn').disabled=!challenge;$('catchUnoBtn').disabled=!roomState.players.some(p=>p.id!==socket.id&&p.count===1&&!p.calledUno);const top=roomState.topCard;$('topCard').className=`uno-card top-card ${top?.color||'wild'}`;$('topCard').innerHTML=`<span>${esc(cardLabel(top))}</span>`;const color=roomState.currentColor||'—';$('currentColorText').textContent=color.toUpperCase();$('currentColorDot').style.background=({red:'#f34e62',yellow:'#f6c943',green:'#36c98b',blue:'#4389ff'})[color]||'#999';$('scoreBoard').innerHTML=roomState.players.map(p=>`<span class="score-chip">${esc(p.name)} <b>${p.score||0}</b> pts</span>`).join('');$('gamePlayers').innerHTML=roomState.players.map(p=>`<div class="game-player ${p.id===roomState.currentPlayerId&&!roomState.winnerId?'active-turn':''}"><div class="avatar">${esc(p.name.charAt(0).toUpperCase())}</div><div style="min-width:0"><div class="player-name">${esc(p.name)}${p.id===socket.id?' (You)':''}</div><div class="player-sub">${p.id===roomState.hostId?'Host':p.id===roomState.currentPlayerId?'Playing now':'In the game'}</div></div><span class="cards-count">${p.count} 🂠</span></div>`).join('');$('hand').innerHTML='';myHand.forEach(card=>{const b=document.createElement('button');const canJump=!!roomState.rules?.jumpIn&&!turn&&!roomState.pendingDraw&&!roomState.pendingChallenge&&card.color===roomState.topCard?.color&&card.value===roomState.topCard?.value;const playable=isPlayable(card)&&(turn||canJump)&&(!roomState.drawnCardId||roomState.drawnCardId.playerId!==socket.id||roomState.drawnCardId.cardId===card.id);b.className=`hand-card ${card.color} ${playable?'playable':''}`;b.disabled=!playable||!!roomState.winnerId;b.title=playable?'Play '+cardLabel(card):'Not playable now';b.innerHTML=`<small class="corner">${esc(cardLabel(card))}</small><span>${esc(cardLabel(card))}</span><small class="corner-bottom">${esc(cardLabel(card))}</small>`;b.addEventListener('click',()=>playCard(card));$('hand').appendChild(b);});if(!myHand.length)$('hand').innerHTML='<p class="game-message">Your cards will appear here.</p>';if(roomState.winnerId&&roomState.hostId===socket.id){if(!$('newRoundBtn')){const b=document.createElement('button');b.id='newRoundBtn';b.className='btn btn-purple';b.textContent=roomState.matchWinnerId?'Start new match ↻':'Start new round ↻';b.style.marginTop='12px';b.addEventListener('click',async()=>{const r=await request('newRound');if(r.ok)showToast('New round ready!');});$('gameMessage').appendChild(b);}}else $('newRoundBtn')?.remove();}
function isPlayable(card){return !!roomState?.topCard&&(card.color==='wild'||card.color===roomState.currentColor||card.value===roomState.topCard.value);}
async function playCard(card){const turn=isMyTurn();const canJump=!!roomState?.rules?.jumpIn&&!turn&&!roomState?.pendingDraw&&!roomState?.pendingChallenge&&card.color===roomState?.topCard?.color&&card.value===roomState?.topCard?.value;if(!turn&&!canJump)return;if(!isPlayable(card))return;if(card.color==='wild'){pendingWildCard=card.id;$('colorModal').classList.remove('hidden');return;}await request('playCard',{cardId:card.id});}
function cardLabel(card){if(!card)return'?';return({skip:'⊘',reverse:'↻',draw2:'+2',wild:'✦',wild4:'+4'})[card.value]||card.value;}
$('soundBtn').setAttribute('aria-pressed','true');
$('soundBtn').title='Voice announcements on';
$('soundBtn').addEventListener('click',()=>{
  voiceAnnouncementsEnabled=!voiceAnnouncementsEnabled;
  $('soundBtn').setAttribute('aria-pressed',String(voiceAnnouncementsEnabled));
  $('soundBtn').classList.toggle('sound-muted',!voiceAnnouncementsEnabled);
  $('soundBtn').title=voiceAnnouncementsEnabled?'Voice announcements on':'Voice announcements off';
  $('soundBtn').textContent=voiceAnnouncementsEnabled?'◖))':'🔇';
  if(!voiceAnnouncementsEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  showToast(voiceAnnouncementsEnabled?'UNO voice announcements enabled.':'UNO voice announcements muted.');
});
