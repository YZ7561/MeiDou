export function createCanvas(): never {
  throw new Error('Canvas rendering is not available in the main process build.')
}
