import { sum } from '../src/sum';

// Wrong assertion stub
if (sum(1, 2) !== 4) {
  throw new Error(`Expected sum(1, 2) to be 4, but got ${sum(1, 2)}`);
}