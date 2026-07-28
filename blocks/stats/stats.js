/**
 * Returns the largest factor of n between 1 and 4.
 * @param {number} n - Number of stat items
 * @returns {number} Columns per row
 */
function getLargestFactor(n) {
  const factor = [4, 3, 2].find((f) => n % f === 0);
  if (factor) return factor;
  if (n > 4) return n % 2 === 0 ? 4 : 3;
  return 1;
}

export default function decorate(block) {
  const definedCols = [...block.classList].find((c) => c.startsWith('cols-'));
  if (!definedCols) {
    block.classList.add(`cols-${getLargestFactor(block.children.length)}`);
  } else {
    block.classList.remove(definedCols);
    block.classList.add(`cols-${definedCols.split('-')[1]}`);
  }

  const stats = [...block.children];
  const cols = ['value', 'description'];
  stats.forEach((stat) => {
    [...stat.children].forEach((col, i) => {
      col.classList.add(cols[i]);
    });
  });
}
