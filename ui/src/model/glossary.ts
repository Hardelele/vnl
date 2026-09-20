/**
 * Расшифровка подписей: рецепторы, мембрана, контакт, направления портов.
 *
 * Своих текстов здесь нет и быть не должно. Что такое `gaba_a` -- предметное
 * знание, и лежит оно там же, где числа, которыми его считают (`ir.RECEPTORS`,
 * `ir.POINT_NOTES`, `ir.CONTACT_NOTES`, `patterns.PORT_NOTES`). Второй словарь
 * в браузере разошёлся бы с первым незаметно: подсказка ни на один прогон не
 * влияет, и на тестах прогона расхождение не всплыло бы.
 *
 * Отдельным запросом от каталога клеток: каталог меняется вместе с
 * хранилищем, а это реестр -- одинаковый на любой машине и на любом проекте.
 * У клетки объяснение своё и приходит с ней самой (`CellKind.note`).
 */

import { request } from './catalog'
import type { Glossary, Receptor, RecordedVar } from './types'

/** Пустая расшифровка: экран обязан работать и до ответа сервера. */
export const NO_GLOSSARY: Glossary = {
  schema: 0,
  receptors: [],
  cell: {},
  contact: {},
  port: {},
  recorded: [],
}

export async function loadGlossary(): Promise<Glossary> {
  return request<Glossary>('/api/glossary')
}

/**
 * Подсказка к рецептору: объяснение плюс его же числа.
 *
 * Числа берутся из полей ответа, а не пересказываются словами: реверсал и спад
 * -- те самые, по которым синапс и считается, и повтори их в тексте, правка
 * `tau_decay` оставила бы в подсказке старое число.
 *
 * Здесь, а не в панели свойств, потому что спрашивают об этом в двух местах:
 * песочница объясняет рецептор в поле выбора, карточка -- в строке связи и в
 * драйве (#546). Второе такое же склеивание разошлось бы с первым при первой
 * же правке формата.
 */
export function receptorNote(receptor: Receptor): string {
  return `${receptor.note} Реверсал ${receptor.reversal} мВ, спад ${receptor.tauDecay} мс.`
}

/** Та же подсказка по имени рецептора. Нет в словаре -- нет и подсказки. */
export function receptorHint(glossary: Glossary, id: string): string | undefined {
  const receptor = glossary.receptors.find((item) => item.id === id)
  return receptor ? receptorNote(receptor) : undefined
}

/**
 * Величина записи словами: «возбуждающая проводимость, нСм».
 *
 * Пока словаря нет, показывается машинное имя (`g_exc`): выдумывать перевод
 * здесь значило бы завести второй реестр величин -- тот, что уже есть в
 * `ir.RECORDED`, придёт следующим ответом и перепишет подпись сам.
 */
export function recordedName(glossary: Glossary, id: RecordedVar): string {
  const variable = glossary.recorded.find((item) => item.id === id)
  if (!variable) return id
  return variable.unit ? `${variable.name}, ${variable.unit}` : variable.name
}
