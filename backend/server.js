const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { COLORS, shuffle, createClassicDeck } = require('./src/game/deck');
const { canPlay, canLegallyPlayWild4, points } = require('./src/game/rules');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
app.use(express.static(path.resolve(__dirname, '../frontend/public')));
app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, '../frontend/public/index.html')));
const rooms = new Map();
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({length:6}, () => codeChars[crypto.randomInt(codeChars.length)]).join('');
const cleanName = v => String(v || '').trim().replace(/[<>]/g, '').slice(0,18) || 'Player';
const err = (cb, message) => typeof cb === 'function' && cb({ok:false,error:message});
const ok = (cb, extra={}) => typeof cb === 'function' && cb({ok:true,...extra});
function getRoom(socket) { return rooms.get(socket.data.roomCode); }
function current(room) { return room.players[room.turn]; }
function nextIndex(room, from=room.turn, steps=1) { const n=room.players.length; return (from + room.direction*steps%n+n)%n; }
function advance(room, steps=1) { room.turn = nextIndex(room, room.turn, steps); }
function drawCards(room, player, count) {
  for(let i=0;i<count;i++) {
    if(!room.deck.length) {
      if(room.discard.length<=1) break;
      const top=room.discard.pop(); room.deck=shuffle(room.discard); room.discard=[top];
    }
    if(room.deck.length) player.hand.push(room.deck.pop());
  }
}
function publicState(room) {
  return { code:room.code, hostId:room.hostId, maxPlayers:room.maxPlayers, rules:room.rules,
    started:room.started, direction:room.direction, currentColor:room.currentColor,
    topCard:room.discard[room.discard.length-1]||null, currentPlayerId:current(room)?.id||null,
    players:room.players.map((p,i)=>({id:p.id,name:p.name,count:p.hand.length,score:p.score||0,isHost:p.id===room.hostId,isCurrent:room.started&&i===room.turn,calledUno:!!p.calledUno})),
    drawCount:room.deck.length,discardCount:room.discard.length,winnerId:room.winnerId,matchWinnerId:room.matchWinnerId||null,
    roundNumber:room.roundNumber,pendingDraw:room.pendingDraw?{targetId:room.pendingDraw.targetId,amount:room.pendingDraw.amount}:null,
    pendingChallenge:room.pendingChallenge?{targetId:room.pendingChallenge.targetId,offenderId:room.pendingChallenge.offenderId}:null,
    drawnCardId:room.drawnCardId||null };
}
function emitRoom(room) {
  io.to(room.code).emit('state',publicState(room));
  for(const p of room.players) io.to(p.id).emit('hand',room.started?p.hand:[]);
}
function say(room,message) { io.to(room.code).emit('notice',message); }
function roomFor(socket, cb) { const room=getRoom(socket); if(!room) err(cb,'You are not in a room. Create or join a room first.'); return room; }
function endRound(room,winner) {
  room.winnerId=winner.id;
  const earned=room.players.filter(p=>p.id!==winner.id).reduce((sum,p)=>sum+p.hand.reduce((s,c)=>s+points(c),0),0);
  winner.score=(winner.score||0)+earned;
  const target=room.rules.winTarget==='single'?0:Number(room.rules.winTarget||500);
  if(target && winner.score>=target) room.matchWinnerId=winner.id;
  emitRoom(room); say(room,`🏆 ${winner.name} wins the round and scores ${earned} points!${room.matchWinnerId===winner.id?' They win the match!':''}`);
}
function removePlayer(socket) {
  const code=socket.data.roomCode; if(!code) return;
  const room=rooms.get(code); socket.data.roomCode=null;
  if(!room) return;
  const at=room.players.findIndex(p=>p.id===socket.id); if(at<0) return;
  const [removed]=room.players.splice(at,1); socket.leave(code);
  if(!room.players.length){rooms.delete(code);return;}
  if(room.hostId===removed.id) room.hostId=room.players[0].id;
  if(room.started){ if(at<room.turn) room.turn--; if(room.turn>=room.players.length) room.turn=0; room.pendingChallenge=null; room.pendingDraw=null; room.drawnCardId=null; if(room.players.length<2){room.started=false;room.players.forEach(p=>p.hand=[]);say(room,'Not enough players remain. Waiting for another player.');} }
  emitRoom(room); say(room,`${removed.name} left the room.`);
}
function startRound(room) {
  room.deck=createClassicDeck(); room.discard=[]; room.direction=1; room.turn=0; room.winnerId=null; room.pendingDraw=null; room.pendingChallenge=null; room.drawnCardId=null; room.roundNumber++;
  for(const p of room.players){p.hand=[];p.calledUno=false;}
  for(let i=0;i<7;i++) for(const p of room.players) p.hand.push(room.deck.pop());
  let first=room.deck.pop();
  // Keep the opening discard simple and unambiguous: start with a number card.
  while(first && (first.color==='wild'||!/^\d$/.test(first.value))) { room.deck.unshift(first); first=room.deck.pop(); }
  if(!first){room.deck=createClassicDeck();first=room.deck.pop();}
  room.discard.push(first); room.currentColor=first.color; room.started=true;
}
function validRules(input={}) {
  const winTarget=['single','100','250','500'].includes(String(input.winTarget))?String(input.winTarget):'500';
  return {winTarget,stacking:!!input.stacking,sevenZero:!!input.sevenZero,jumpIn:!!input.jumpIn};
}
function doPlay(room, player, cardIndex, chosenColor, {jumpIn=false}={}) {
  const card=player.hand[cardIndex], top=room.discard[room.discard.length-1];
  if(!canPlay(card,top,room.currentColor)) return {ok:false,error:'That card does not match the current color or symbol.'};
  if(card.color==='wild'&&!COLORS.includes(chosenColor)) return {ok:false,error:'Choose red, yellow, green, or blue for a Wild card.'};
  if(room.pendingChallenge && !jumpIn) return {ok:false,error:'Resolve the +4 challenge first.'};
  if(room.pendingDraw && room.rules.stacking) {
    const stackable=(room.pendingDraw.lastType==='draw2'&&card.value==='draw2')||(room.pendingDraw.lastType==='wild4'&&card.value==='wild4');
    if(!stackable) return {ok:false,error:`Play a matching draw card to stack or draw ${room.pendingDraw.amount} cards.`};
  } else if(room.pendingDraw && !room.rules.stacking) return {ok:false,error:'The draw penalty must resolve first.'};
  const activeColor=room.currentColor;
  const legalWild4=card.value!=='wild4'||canLegallyPlayWild4(player.hand.filter((_,i)=>i!==cardIndex),activeColor);
  player.hand.splice(cardIndex,1); player.calledUno=false; room.discard.push(card); room.currentColor=card.color==='wild'?chosenColor:card.color;
  room.drawnCardId=null;
  if(player.hand.length===1) { player.calledUno=false; player.unoDeadline=true; }
  if(player.hand.length===0) {
    if(card.value==='draw2'||card.value==='wild4') { advance(room); drawCards(room,current(room),card.value==='draw2'?2:4); }
    room.pendingDraw=null; room.pendingChallenge=null; endRound(room,player); return {ok:true};
  }
  if(card.value==='draw2'||card.value==='wild4') {
    const amount=card.value==='draw2'?2:4;
    advance(room);
    if(room.rules.stacking) room.pendingDraw={targetId:current(room).id,amount:(room.pendingDraw?.amount||0)+amount,lastType:card.value,offenderId:player.id};
    else if(card.value==='wild4') room.pendingChallenge={targetId:current(room).id,offenderId:player.id,legal:legalWild4,chosenColor};
    else {drawCards(room,current(room),2);advance(room);}
  } else if(card.value==='skip') advance(room,2);
  else if(card.value==='reverse') { room.direction*=-1; if(room.players.length===2) advance(room,2); else advance(room); }
  else if(room.rules.sevenZero && card.value==='7') {
    // 7 swaps the current player's remaining hand with one selected opponent; default next player.
    const target=current(room); const old=player.hand; player.hand=target.hand; target.hand=old; advance(room);
  } else if(room.rules.sevenZero && card.value==='0') {
    const hands=room.players.map(p=>p.hand);
    if(room.direction===1) room.players.unshift(room.players.pop()); else room.players.push(room.players.shift());
    room.players.forEach((p,i)=>p.hand=hands[(i-1+hands.length)%hands.length]);
    room.turn=room.players.findIndex(p=>p.id===player.id); advance(room);
  } else { room.pendingDraw=null; advance(room); }
  return {ok:true};
}
io.on('connection',socket=>{
  socket.on('createRoom',(payload={},cb=()=>{})=>{
    if(socket.data.roomCode) removePlayer(socket);
    let code; do{code=makeCode();}while(rooms.has(code));
    const limit=Math.max(2,Math.min(10,Number(payload.maxPlayers)||10));
    const room={code,hostId:socket.id,maxPlayers:limit,rules:validRules(payload.rules),players:[{id:socket.id,name:cleanName(payload.name),hand:[],score:0,calledUno:false}],started:false,deck:[],discard:[],turn:0,direction:1,currentColor:null,winnerId:null,matchWinnerId:null,roundNumber:0,pendingDraw:null,pendingChallenge:null,drawnCardId:null};
    rooms.set(code,room);socket.join(code);socket.data.roomCode=code;emitRoom(room);ok(cb,{code});
  });
  socket.on('joinRoom',(payload={},cb=()=>{})=>{
    const code=String(payload.code||'').trim().toUpperCase();
    // Never create a room from join. Invalid codes return a clear error and leave the client in the lobby.
    if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return err(cb,'Invalid room code. Enter the 6-character code shared by the host.');
    const room=rooms.get(code); if(!room) return err(cb,'Room code not found. Check the code and try again.');
    if(room.started) return err(cb,'This game has already started. Ask the host to create a new room.');
    if(room.players.length>=room.maxPlayers) return err(cb,`This room is full (${room.maxPlayers} players).`);
    if(socket.data.roomCode) removePlayer(socket);
    const p={id:socket.id,name:cleanName(payload.name),hand:[],score:0,calledUno:false};room.players.push(p);socket.join(code);socket.data.roomCode=code;
    emitRoom(room);say(room,`${p.name} joined the room.`);ok(cb,{code});
  });
  socket.on('startGame',(cb=()=>{})=>{
    const room=roomFor(socket,cb);if(!room)return;
    if(room.hostId!==socket.id)return err(cb,'Only the room host can start the game.');
    if(room.players.length<2)return err(cb,'At least 2 players are required to start.');
    if(room.matchWinnerId){room.players.forEach(p=>p.score=0);room.matchWinnerId=null;}
    startRound(room);emitRoom(room);say(room,'Game started! Match the color, number, or symbol. Call UNO when one card remains.');ok(cb);
  });
  socket.on('playCard',(payload={},cb=()=>{})=>{
    const room=roomFor(socket,cb);if(!room)return;
    if(!room.started||room.winnerId)return err(cb,'There is no active round.');
    const player=room.players.find(p=>p.id===socket.id);if(!player)return err(cb,'You are not a player in this room.');
    const index=player.hand.findIndex(c=>c.id===Number(payload.cardId));if(index<0)return err(cb,'That card is not in your hand.');
    const isTurn=current(room)?.id===socket.id;
    const card=player.hand[index];
    if(!isTurn){
      if(!(room.rules.jumpIn&&!room.pendingDraw&&!room.pendingChallenge&&card.color===room.discard.at(-1)?.color&&card.value===room.discard.at(-1)?.value)) return err(cb,'It is not your turn.');
      room.turn=room.players.findIndex(p=>p.id===socket.id);
    }
    if(room.drawnCardId && room.drawnCardId.playerId===socket.id && room.drawnCardId.cardId!==card.id) return err(cb,'After drawing, you may only play the card you just drew or pass.');
    const result=doPlay(room,player,index,payload.chosenColor,{jumpIn:!isTurn});if(!result.ok)return err(cb,result.error);
    emitRoom(room);say(room,`${player.name} played ${card.value==='draw2'?'+2':card.value==='wild4'?'+4':card.value==='wild'?'Wild':card.value}.`);ok(cb);
  });
  socket.on('drawCard',(cb=()=>{})=>{
    const room=roomFor(socket,cb);if(!room)return;
    if(!room.started||room.winnerId)return err(cb,'There is no active round.');
    if(current(room)?.id!==socket.id)return err(cb,'Wait for your turn.');
    if(room.pendingChallenge)return err(cb,'Challenge or accept the +4 first.');
    const player=current(room);
    if(room.pendingDraw){
      if(room.rules.stacking)return err(cb,`Play a matching +2/+4 to stack, or accept ${room.pendingDraw.amount} cards.`);
      const amount=room.pendingDraw.amount;drawCards(room,player,amount);room.pendingDraw=null;advance(room);room.drawnCardId=null;emitRoom(room);say(room,`${player.name} drew ${amount} penalty cards and lost the turn.`);return ok(cb);
    }
    if(room.drawnCardId?.playerId===socket.id)return err(cb,'You already drew a card. Play it if legal or pass your turn.');
    const before=player.hand.length;drawCards(room,player,1);const drawn=player.hand[before];
    room.drawnCardId=drawn?{playerId:socket.id,cardId:drawn.id}:null;
    emitRoom(room);say(room,`${player.name} drew a card. Play it if legal or pass.`);ok(cb,{drawnCardId:drawn?.id||null});
  });
  socket.on('passTurn',(cb=()=>{})=>{
    const room=roomFor(socket,cb);if(!room)return;
    if(current(room)?.id!==socket.id)return err(cb,'Wait for your turn.');
    if(!room.drawnCardId||room.drawnCardId.playerId!==socket.id)return err(cb,'Draw a card before passing.');
    room.drawnCardId=null;advance(room);emitRoom(room);say(room,`${room.players[(room.turn-room.direction+room.players.length)%room.players.length]?.name||'Player'} passed after drawing.`);ok(cb);
  });
  socket.on('callUno',(cb=()=>{})=>{
    const room=roomFor(socket,cb);if(!room)return;
    const p=room.players.find(p=>p.id===socket.id);if(!p||p.hand.length!==1)return err(cb,'You can call UNO only when you have exactly one card.');
    p.calledUno=true;p.unoDeadline=false;emitRoom(room);say(room,`📣 ${p.name} calls UNO!`);ok(cb);
  });
  socket.on('catchUno',(payload={},cb=()=>{})=>{
    const room=roomFor(socket,cb);if(!room)return;
    const target=room.players.find(p=>p.id===payload.playerId);
    if(!target||target.id===socket.id||target.hand.length!==1||target.calledUno)return err(cb,'That player has already called UNO or cannot be caught.');
    drawCards(room,target,2);target.calledUno=true;emitRoom(room);say(room,`${target.name} was caught and draws 2 cards.`);ok(cb);
  });
  socket.on('challengeWild4',(cb=()=>{})=>{
    const room=roomFor(socket,cb);if(!room)return;const ch=room.pendingChallenge;
    if(!ch||ch.targetId!==socket.id)return err(cb,'Only the player facing +4 can challenge it.');
    const target=room.players.find(p=>p.id===ch.targetId), offender=room.players.find(p=>p.id===ch.offenderId);
    if(ch.legal){drawCards(room,target,6);room.turn=room.players.findIndex(p=>p.id===target.id);advance(room);room.pendingChallenge=null;room.drawnCardId=null;}
    else {drawCards(room,offender,4);room.turn=room.players.findIndex(p=>p.id===offender.id);room.pendingChallenge=null;advance(room);room.drawnCardId=null;}
    emitRoom(room);say(room,ch.legal?`${target.name} challenged legally played +4 and draws 6 cards.`:`Challenge successful! ${offender.name} draws 4 cards.`);ok(cb);
  });
  socket.on('acceptWild4',(cb=()=>{})=>{
    const room=roomFor(socket,cb);if(!room)return;const ch=room.pendingChallenge;
    if(!ch||ch.targetId!==socket.id)return err(cb,'Only the player facing +4 can accept it.');
    const target=room.players.find(p=>p.id===socket.id);drawCards(room,target,4);room.pendingChallenge=null;room.drawnCardId=null;advance(room);emitRoom(room);say(room,`${target.name} accepted +4 and drew four cards.`);ok(cb);
  });
  socket.on('newRound',(cb=()=>{})=>{
    const room=roomFor(socket,cb);if(!room)return;if(room.hostId!==socket.id)return err(cb,'Only the host can start a new round.');
    if(room.matchWinnerId){room.players.forEach(p=>p.score=0);room.matchWinnerId=null;}startRound(room);emitRoom(room);say(room,'A new round has started.');ok(cb);
  });
  socket.on('leaveRoom',()=>removePlayer(socket));
  socket.on('disconnect',()=>removePlayer(socket));
});
server.listen(PORT,()=>console.log(`UNO PARTY server running at http://localhost:${PORT}`));
