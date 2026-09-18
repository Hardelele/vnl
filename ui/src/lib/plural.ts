/**
 * Русские числительные: «1 паттерн», «2 паттерна», «5 паттернов».
 *
 * Мелочь, но видна она в каждой карточке каталога, а «3 нейронов» читается
 * как опечатка в данных, а не как недоделка интерфейса.
 */

export interface Forms {
  /** 1 паттерн */
  one: string
  /** 2 паттерна */
  few: string
  /** 5 паттернов */
  many: string
}

export function plural(count: number, forms: Forms): string {
  const abs = Math.abs(count) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return forms.many
  if (last > 1 && last < 5) return forms.few
  if (last === 1) return forms.one
  return forms.many
}

export function counted(count: number, forms: Forms): string {
  return `${count} ${plural(count, forms)}`
}

export const PATTERNS: Forms = {
  one: 'паттерн',
  few: 'паттерна',
  many: 'паттернов',
}

export const NEURONS: Forms = { one: 'нейрон', few: 'нейрона', many: 'нейронов' }

export const LINKS: Forms = { one: 'связь', few: 'связи', many: 'связей' }

export const PORTS: Forms = { one: 'порт', few: 'порта', many: 'портов' }
