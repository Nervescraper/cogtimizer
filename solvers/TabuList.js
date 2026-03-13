// TabuList.js

/**
 * Ring-buffer tabu list with O(1) lookup via a Map (reference-counted).
 * Moves are normalized so (a,b) and (b,a) are the same entry.
 */
class TabuList {
  /**
   * @param {number} tenure - Maximum number of moves to remember.
   */
  constructor(tenure) {
    this.tenure = tenure;
    /** @type {string[]} Ring buffer of normalized move keys */
    this._ring = new Array(tenure).fill(null);
    /** @type {Map<string, number>} Reference-counted membership lookup */
    this._counts = new Map();
    /** @type {number} Next write position in ring buffer */
    this._head = 0;
  }

  /**
   * Normalize a pair (a, b) to a canonical string key.
   * Always puts the smaller index first so (a,b) === (b,a).
   * @param {number} a
   * @param {number} b
   * @returns {string}
   */
  _key(a, b) {
    return a < b ? `${a},${b}` : `${b},${a}`;
  }

  /**
   * Add a move to the tabu list, evicting the oldest if full.
   * @param {number} a - First position index
   * @param {number} b - Second position index
   */
  add(a, b) {
    var key = this._key(a, b);
    // Evict the entry currently occupying this ring slot
    var evicted = this._ring[this._head];
    if (evicted !== null) {
      var count = this._counts.get(evicted) || 0;
      if (count <= 1) {
        this._counts.delete(evicted);
      } else {
        this._counts.set(evicted, count - 1);
      }
    }
    this._ring[this._head] = key;
    this._counts.set(key, (this._counts.get(key) || 0) + 1);
    this._head = (this._head + 1) % this.tenure;
  }

  /**
   * Check if a move is currently tabu.
   * @param {number} a
   * @param {number} b
   * @returns {boolean}
   */
  has(a, b) {
    return (this._counts.get(this._key(a, b)) || 0) > 0;
  }

  /**
   * Remove all entries from the tabu list.
   */
  clear() {
    this._ring.fill(null);
    this._counts.clear();
    this._head = 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TabuList };
}
