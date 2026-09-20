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
import type {
  DriveKindInfo,
  DriveParam,
  Glossary,
  Receptor,
  RecordedVar,
} from './types'

/** Пустая расшифровка: экран обязан работать и до ответа сервера. */
export const NO_GLOSSARY: Glossary = {
  schema: 0,
  receptors: [],
  cell: {},
  models: [],
  contact: {},
  port: {},
  recorded: [],
  drive: '',
  drives: [],
  sensor: '',
  sensors: [],
  motor: '',
  motors: [],
  value: { min: 0, max: 1 },
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

/**
 * Род драйва по имени -- ради его объяснения и его полей.
 *
 * Пока ответа сервера нет, рода нет и здесь: выдумывать за него поля нельзя --
 * панель нарисовала бы «Частоту» там, где у протокола её не бывает. Что
 * показывать в этом случае, решает сама панель; у неё есть то, что в проекте.
 */
export function driveKind(glossary: Glossary, id: string): DriveKindInfo | undefined {
  return driveKinds(glossary).find((item) => item.id === id)
}

/**
 * Роды драйва из ответа сервера. Нет их в ответе -- нет и родов.
 *
 * Проверка не формальная: ответ приходит от сервера, а сервер бывает старее
 * страницы -- вкладку держат открытой неделями. Обращение к полю, которого в
 * ответе нет, уронило бы не подсказку, а весь экран, ради которого страницу и
 * открыли.
 */
export function driveKinds(glossary: Glossary): DriveKindInfo[] {
  return glossary.drives ?? []
}

/**
 * Подпись поля протокола: «Частота, Гц».
 *
 * Единица приклеивается здесь, а не пишется в реестре вместе с подписью, по
 * той же причине, что и у рецептора: подпись и единица -- разные вещи, и
 * поле без единицы (число импульсов) не должно получать запятую в никуда.
 */
export function driveParamLabel(param: DriveParam): string {
  return param.unit ? `${param.label}, ${param.unit}` : param.label
}

/**
 * Объяснение рода драйва по его имени. Нет в словаре -- нет и подсказки.
 *
 * Тем же устройством, что `receptorHint`, и по той же причине: спрашивают об
 * этом не в одном месте. Панель свойств объясняет род в поле выбора, дерево
 * объектов -- в строке стимула, карточка паттерна -- в строке драйва. Вторая
 * такая склейка разошлась бы с первой на первой же правке формата (#553).
 *
 * Название рода приписано к объяснению нарочно: в дереве и на карточке текст
 * висит на словах протокола («поезд, 8 импульсов, 20 Гц»), а не на самом
 * слове «поезд», и без имени подсказка начиналась бы с середины разговора.
 */
export function driveHint(glossary: Glossary, id: string): string | undefined {
  const kind = driveKind(glossary, id)
  if (!kind) return undefined
  return kind.note ? `${kind.name}. ${kind.note}` : kind.name
}
