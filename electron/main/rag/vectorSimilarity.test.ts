import { strict as assert } from 'node:assert'
import { cosineSimilarity } from './vectorSimilarity'

export function runCosineSimilarityVerification(): void {
  assertNearlyEqual(cosineSimilarity([1, 0], [1, 0]), 1)
  assertNearlyEqual(cosineSimilarity([1, 0], [0, 1]), 0)
  assertNearlyEqual(cosineSimilarity([1, 1], [1, 1]), 1)
  assert.equal(cosineSimilarity([], []), 0)
  assert.equal(cosineSimilarity([1], [1, 0]), 0)
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0)
}

function assertNearlyEqual(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `Expected ${actual} to be nearly equal to ${expected}.`
  )
}

runCosineSimilarityVerification()
