const crypto = require('crypto');
const COLORS = ['red', 'blue', 'green', 'yellow'];
function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function createClassicDeck() {
  const cards = []; let id = 1;
  for (const color of COLORS) {
    cards.push({ id: id++, color, value: '0' });
    for (let n = 1; n <= 9; n++) {
      cards.push({ id: id++, color, value: String(n) }, { id: id++, color, value: String(n) });
    }
    for (const value of ['skip', 'reverse', 'draw2']) {
      cards.push({ id: id++, color, value }, { id: id++, color, value });
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ id: id++, color: 'wild', value: 'wild' }, { id: id++, color: 'wild', value: 'wild4' });
  return shuffle(cards);
}
module.exports = { COLORS, shuffle, createClassicDeck };
