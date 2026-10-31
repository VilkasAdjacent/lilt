// Sliding analysis frame shared by the main-thread and Worker analysis paths.
export const FRAME = 2048;

/** Shift `ring` left by block.length and append `block` at the end. */
export function pushBlock(ring, block) {
  if (block.length >= ring.length) { ring.set(block.subarray(block.length - ring.length)); return; }
  ring.copyWithin(0, block.length);
  ring.set(block, ring.length - block.length);
}
