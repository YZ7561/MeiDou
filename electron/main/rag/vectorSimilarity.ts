export function cosineSimilarity(firstVector: number[], secondVector: number[]): number {
  if (!isComparableVector(firstVector, secondVector)) return 0

  let dotProduct = 0
  let firstMagnitude = 0
  let secondMagnitude = 0

  for (let index = 0; index < firstVector.length; index += 1) {
    const firstValue = firstVector[index]
    const secondValue = secondVector[index]

    dotProduct += firstValue * secondValue
    firstMagnitude += firstValue * firstValue
    secondMagnitude += secondValue * secondValue
  }

  if (firstMagnitude === 0 || secondMagnitude === 0) return 0

  return dotProduct / (Math.sqrt(firstMagnitude) * Math.sqrt(secondMagnitude))
}

function isComparableVector(firstVector: number[], secondVector: number[]): boolean {
  return (
    firstVector.length > 0 &&
    firstVector.length === secondVector.length &&
    firstVector.every(isFiniteNumber) &&
    secondVector.every(isFiniteNumber)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
