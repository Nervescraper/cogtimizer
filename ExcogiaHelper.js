// ExcogiaHelper.js
// Shared helpers for Excogia block detection and validation.

if (typeof require !== 'undefined') {
  var _cogMod = require('./CogInventory.js');
  Cog = _cogMod.Cog;
}

var INV_COLUMNS = 12;
var INV_ROWS = 8;

var EXCOGIA_BOOST = {
  boostRadius: 'everything',
  buildRadiusBoost: 1.25,
  expRadiusBoost: 20,
};

function isYinPiece(cog) {
  if (!cog || !cog.icon) return false;
  var path = typeof cog.icon === 'string' ? cog.icon : (cog.icon.path || '');
  return path.indexOf('Yin_') !== -1;
}

var QUADRANT_MAP = {
  'Top_Left': 'TL',
  'Top_Right': 'TR',
  'Bottom_Left': 'BL',
  'Bottom_Right': 'BR',
};

function getYinQuadrant(cog) {
  if (!isYinPiece(cog)) return null;
  var path = typeof cog.icon === 'string' ? cog.icon : (cog.icon.path || '');
  for (var pattern in QUADRANT_MAP) {
    if (path.indexOf(pattern) !== -1) return QUADRANT_MAP[pattern];
  }
  return null;
}

/**
 * Scan board positions and return an array of valid Excogia blocks.
 * Each block is { tlKey, trKey, blKey, brKey } with the board position keys.
 *
 * @param {function} getCog - function(key) returning the Cog at that board position, or falsy
 * @param {number[]} boardKeys - array of board position keys to scan (0-95)
 * @returns {Array<{tlKey: number, trKey: number, blKey: number, brKey: number}>}
 */
function findExcogiaBlocks(getCog, boardKeys) {
  // Build a map of board position -> quadrant for Yin pieces
  var yinPositions = {}; // key -> quadrant string
  for (var i = 0; i < boardKeys.length; i++) {
    var key = boardKeys[i];
    var cog = getCog(key);
    if (!cog) continue;
    var q = getYinQuadrant(cog);
    if (q) yinPositions[key] = q;
  }

  // Find valid 2x2 blocks: TL at (r,c), TR at (r,c+1), BL at (r+1,c), BR at (r+1,c+1)
  var blocks = [];
  var used = {};
  for (var tlKey in yinPositions) {
    if (yinPositions[tlKey] !== 'TL') continue;
    tlKey = Number(tlKey);
    if (used[tlKey]) continue;
    var row = Math.floor(tlKey / INV_COLUMNS);
    var col = tlKey % INV_COLUMNS;
    if (col + 1 >= INV_COLUMNS || row + 1 >= INV_ROWS) continue; // 2x2 must fit on board

    var trKey = row * INV_COLUMNS + (col + 1);
    var blKey = (row + 1) * INV_COLUMNS + col;
    var brKey = (row + 1) * INV_COLUMNS + (col + 1);

    if (yinPositions[trKey] === 'TR' && !used[trKey] &&
        yinPositions[blKey] === 'BL' && !used[blKey] &&
        yinPositions[brKey] === 'BR' && !used[brKey]) {
      blocks.push({ tlKey: tlKey, trKey: trKey, blKey: blKey, brKey: brKey });
      used[tlKey] = true;
      used[trKey] = true;
      used[blKey] = true;
      used[brKey] = true;
    }
  }
  return blocks;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isYinPiece, getYinQuadrant, findExcogiaBlocks, EXCOGIA_BOOST };
}
