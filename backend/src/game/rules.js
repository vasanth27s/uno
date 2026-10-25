const COLORS = ['red', 'blue', 'green', 'yellow'];
function canPlay(card, topCard, activeColor) {
  return !!card && !!topCard && (card.color === 'wild' || card.color === activeColor || card.value === topCard.value);
}
function canLegallyPlayWild4(handWithoutCard, activeColor) {
  // Only a card of the active color makes Wild Draw Four illegal.
  return !handWithoutCard.some(card => card.color === activeColor && card.color !== 'wild');
}
function points(card) {
  if (/^\d$/.test(card.value)) return Number(card.value);
  if (['skip', 'reverse', 'draw2'].includes(card.value)) return 20;
  return 50;
}
function label(value) { return ({ skip: 'SKIP', reverse: 'REVERSE', draw2: '+2', wild: 'WILD', wild4: '+4' })[value] || value; }
module.exports = { COLORS, canPlay, canLegallyPlayWild4, points, label };
