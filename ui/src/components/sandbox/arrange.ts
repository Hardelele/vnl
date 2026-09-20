/**
 * «Разложить»: где должны стоять объекты песочницы (#543).
 *
 * Раскладку считает ELK -- тот же движок и те же настройки, что у схемы
 * карточки и у миниатюр каталога (`lib/place.ts`). Разница не в движке, а в
 * том, что получается: на карточке раскладка -- показ, её результат никуда не
 * ложится, а здесь место объекта часть проекта, и посчитанные места уезжают на
 * сервер через `Project`.
 *
 * Считается раскладка в браузере, а не на сервере, потому что раскладывается
 * то, что видно: размер фигуры задаёт холст, а раскрытие блока (#530) вообще
 * живёт только на экране и на сервер не уходит. Серверный `vnl.layout` отвечает
 * на другой вопрос -- как расставить клетки сети с сомой, дендритами и аксоном,
 * -- и размеров коробок не принимает вовсе.
 *
 * Размер каждого узла настоящий: свёрнутый блок 150x62, раскрытый 236x152,
 * клетка 74x38. Одинаковые квадраты вместо фигур дали бы раскладку не этой
 * схемы -- ELK разводит узлы по габаритам, и раскрытый блок налез бы на соседа
 * или получил бы вчетверо больше места, чем ему нужно.
 */

import { placeBoxes, type LayoutBox, type LayoutEdge } from '../../lib/place'
import type {
  Places,
  SandboxBlock,
  SandboxLink,
  SandboxMotor,
  SandboxNeuron,
  SandboxSensor,
} from '../../model/sandbox'
import { blockBox, cellBox, doorBox, innerRef } from './Canvas'

/**
 * Отступ от края холста. По вертикали больше: над клеткой стоит её заряд, и
 * прижатая к нулю схема обрезала бы надписи (`viewBox` начинается с нуля).
 */
const MARGIN = { x: 12, y: 30 }

/**
 * Чей это конец связи.
 *
 * Связь ведут и во внутренний узел раскрытого блока (`ffi/I`, #530), но
 * двигается по холсту не он, а блок целиком: для раскладки такая связь --
 * связь с блоком.
 */
function owner(instance: string, blocks: SandboxBlock[]): string {
  return innerRef(instance, blocks)?.block.id ?? instance
}

export async function arrangement(
  blocks: SandboxBlock[],
  neurons: SandboxNeuron[],
  links: SandboxLink[],
  opened: string[],
  /**
   * Двери наружу: они тоже стоят на холсте и тоже раскладываются (#571).
   *
   * Необязательны -- у схемы без границы с миром их нет, и раскладка выходит
   * ровно такой же, какой была. А вот пропустить их, когда они есть, нельзя:
   * связь от сенсора ссылалась бы на узел, которого в графе нет, и ELK
   * споткнулся бы на ней -- то есть «Разложить» перестало бы работать ровно в
   * той схеме, у которой появился сенсор.
   */
  sensors: SandboxSensor[] = [],
  motors: SandboxMotor[] = [],
): Promise<Places> {
  const boxes: LayoutBox[] = [
    ...blocks.map((block) => ({ id: block.id, ...blockBox(opened.includes(block.id)) })),
    ...neurons.map((neuron) => ({ id: neuron.id, ...cellBox() })),
    ...[...sensors, ...motors].map((door) => ({ id: door.id, ...doorBox() })),
  ]
  if (!boxes.length) return {}
  const known = new Set(boxes.map((box) => box.id))

  const edges: LayoutEdge[] = [
    ...links.map((link) => ({
      id: link.id,
      from: owner(link.source.instance, blocks),
      to: owner(link.target.instance, blocks),
    })),
    // Мотор связью не подключён -- он смотрит на клетку. Для раскладки это
    // всё равно «после неё»: иначе ELK положил бы его отдельным островом, и
    // линия к клетке шла бы через всю схему.
    ...motors.map((motor) => ({
      id: `watch-${motor.id}`,
      from: owner(motor.source.instance, blocks),
      to: motor.id,
    })),
  ]
    // Связь объекта на себя (и связь между двумя узлами одного блока) слоя не
    // добавляет, а ELK на ней спотыкается.
    .filter((edge) => edge.from !== edge.to)
    // Конец, которого на холсте нет, -- тоже повод споткнуться: стимул или
    // мотор на исчезнувшую клетку остаётся законным объектом проекта.
    .filter((edge) => known.has(edge.from) && known.has(edge.to))

  const laid = await placeBoxes(boxes, edges)
  const places: Places = {}
  // Место клетки и двери -- середина их фигуры, место блока -- его левый
  // верхний угол: так их рисует холст, и раскладке об этом надо знать.
  const centred = new Set([
    ...neurons.map((neuron) => neuron.id),
    ...sensors.map((sensor) => sensor.id),
    ...motors.map((motor) => motor.id),
  ])
  for (const box of laid.boxes) {
    // ELK отдаёт левый верхний угол. У блока место -- он и есть, а у клетки --
    // середина фигуры: холст рисует её от центра.
    places[box.id] = centred.has(box.id)
      ? [
          Math.round(box.x + box.width / 2 + MARGIN.x),
          Math.round(box.y + box.height / 2 + MARGIN.y),
        ]
      : [Math.round(box.x + MARGIN.x), Math.round(box.y + MARGIN.y)]
  }
  return places
}
