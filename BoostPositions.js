const INV_ROWS = 8;
const INV_COLUMNS = 12;

function getBoostPositions(radiusType, row, col) {
  const positions = [];
  switch (radiusType) {
    case 'diagonal':
      positions.push([row-1, col-1], [row-1, col+1], [row+1, col-1], [row+1, col+1]);
      break;
    case 'adjacent':
      positions.push([row-1, col], [row, col+1], [row+1, col], [row, col-1]);
      break;
    case 'up':
      positions.push([row-2, col-1], [row-2, col], [row-2, col+1], [row-1, col-1], [row-1, col], [row-1, col+1]);
      break;
    case 'right':
      positions.push([row-1, col+2], [row, col+2], [row+1, col+2], [row-1, col+1], [row, col+1], [row+1, col+1]);
      break;
    case 'down':
      positions.push([row+2, col-1], [row+2, col], [row+2, col+1], [row+1, col-1], [row+1, col], [row+1, col+1]);
      break;
    case 'left':
      positions.push([row-1, col-2], [row, col-2], [row+1, col-2], [row-1, col-1], [row, col-1], [row+1, col-1]);
      break;
    case 'row':
      for (let c = 0; c < INV_COLUMNS; c++) {
        if (c === col) continue;
        positions.push([row, c]);
      }
      break;
    case 'column':
      for (let r = 0; r < INV_ROWS; r++) {
        if (r === row) continue;
        positions.push([r, col]);
      }
      break;
    case 'corners':
      positions.push([row-2, col-2], [row-2, col+2], [row+2, col-2], [row+2, col+2]);
      break;
    case 'around':
      positions.push(
        [row-2, col], [row-1, col-1], [row-1, col], [row-1, col+1],
        [row, col-2], [row, col-1], [row, col+1], [row, col+2],
        [row+1, col-1], [row+1, col], [row+1, col+1], [row+2, col]
      );
      break;
    case 'everything':
      for (let r = 0; r < INV_ROWS; r++) {
        for (let c = 0; c < INV_COLUMNS; c++) {
          if (r === row && c === col) continue;
          positions.push([r, c]);
        }
      }
      break;
    default:
      break;
  }
  return positions;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getBoostPositions, INV_ROWS, INV_COLUMNS };
}
