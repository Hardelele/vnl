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
import type { Glossary } from './types'

/** Пустая расшифровка: экран обязан работать и до ответа сервера. */
export const NO_GLOSSARY: Glossary = {
  schema: 0,
  receptors: [],
  cell: {},
  contact: {},
  port: {},
}

export async function loadGlossary(): Promise<Glossary> {
  return request<Glossary>('/api/glossary')
}
