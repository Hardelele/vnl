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
  SandboxNeuron,
} from '../../model/sandbox'
import { blockBox, cellBox, innerRef } from './Canvas'

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
): Promise<Places> {
  const boxes: LayoutBox[] = [
    ...blocks.map((block) => ({ id: block.id, ...blockBox(opened.includes(block.id)) })),
    ...neurons.map((neuron) => ({ id: neuron.id, ...cellBox() })),
  ]
  if (!boxes.length) return {}

  const edges: LayoutEdge[] = links
    .map((link) => ({
      id: link.id,
      from: owner(link.source.instance, blocks),
      to: owner(link.target.instance, blocks),
    }))
    // Связь объекта на себя (и связь между двумя узлами одного блока) слоя не
    // добавляет, а ELK на ней спотыкается.
    .filter((edge) => edge.from !== edge.to)

  const laid = await placeBoxes(boxes, edges)
  const places: Places = {}
  const isCell = new Set(neurons.map((neuron) => neuron.id))
  for (const box of laid.boxes) {
    // ELK отдаёт левый верхний угол. У блока место -- он и есть, а у клетки --
    // середина фигуры: холст рисует её от центра.
    places[box.id] = isCell.has(box.id)
      ? [
          Math.round(box.x + box.width / 2 + MARGIN.x),
          Math.round(box.y + box.height / 2 + MARGIN.y),
        ]
      : [Math.round(box.x + MARGIN.x), Math.round(box.y + MARGIN.y)]
  }
  return places
}
