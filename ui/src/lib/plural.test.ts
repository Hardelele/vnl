import { describe, expect, it } from 'vitest'

import { NEURONS, PATTERNS, counted, plural } from './plural'

describe('русское числительное', () => {
  it('единица', () => {
    expect(plural(1, PATTERNS)).toBe('паттерн')
    expect(plural(21, PATTERNS)).toBe('паттерн')
    expect(plural(101, PATTERNS)).toBe('паттерн')
  })

  it('двойка-четвёрка', () => {
    expect(plural(2, PATTERNS)).toBe('паттерна')
    expect(plural(34, PATTERNS)).toBe('паттерна')
  })

  it('много', () => {
    expect(plural(0, PATTERNS)).toBe('паттернов')
    expect(plural(5, PATTERNS)).toBe('паттернов')
    expect(plural(28, PATTERNS)).toBe('паттернов')
  })

  it('подростковые числа — исключение', () => {
    expect(plural(11, PATTERNS)).toBe('паттернов')
    expect(plural(12, PATTERNS)).toBe('паттернов')
    expect(plural(14, PATTERNS)).toBe('паттернов')
    expect(plural(111, PATTERNS)).toBe('паттернов')
  })

  it('число подставляется вместе с формой', () => {
    expect(counted(3, NEURONS)).toBe('3 нейрона')
  })
})
